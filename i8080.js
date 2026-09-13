/**
 * Intel 8080 CPU core.
 *
 * Memory is a plain Uint8Array(65536); I/O is delegated to a handler object.
 * Every bus cycle is reported through `sample()` so a front panel can average
 * the address/data/status lines over a frame, the way real lamps do.
 */

export const STATUS = {
  INTE: 0x001, // interrupts enabled
  PROT: 0x002, // memory protected
  MEMR: 0x004, // memory read
  INP: 0x008, // input cycle
  M1: 0x010, // instruction fetch
  OUT: 0x020, // output cycle
  HLTA: 0x040, // halt acknowledge
  STACK: 0x080, // stack access
  WO: 0x100, // not writing out
  INT: 0x200, // interrupt requested
};

// Base cycle count per opcode. Taken conditional calls/returns add 6.
const CYCLES = [
  4, 10, 7, 5, 5, 5, 7, 4, 4, 10, 7, 5, 5, 5, 7, 4,
  4, 10, 7, 5, 5, 5, 7, 4, 4, 10, 7, 5, 5, 5, 7, 4,
  4, 10, 16, 5, 5, 5, 7, 4, 4, 10, 16, 5, 5, 5, 7, 4,
  4, 10, 13, 5, 10, 10, 10, 4, 4, 10, 13, 5, 5, 5, 7, 4,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  7, 7, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 5, 7, 5,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  5, 10, 10, 10, 11, 11, 7, 11, 5, 10, 10, 10, 11, 17, 7, 11,
  5, 10, 10, 10, 11, 11, 7, 11, 5, 10, 10, 10, 11, 11, 7, 11,
  5, 10, 10, 18, 11, 11, 7, 11, 5, 5, 10, 5, 11, 5, 7, 11,
  5, 10, 10, 4, 11, 11, 7, 11, 5, 5, 10, 4, 11, 5, 7, 11,
];

// Parity of every byte value, precomputed.
const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let bits = 0;
  for (let b = i; b; b >>= 1) bits ^= b & 1;
  PARITY[i] = bits ? 0 : 1;
}

// Register file indices, matching the 8080 opcode encoding. 6 means "(HL)".
const B = 0, C = 1, D = 2, E = 3, H = 4, L = 5, M = 6, A = 7;

export class I8080 {
  constructor(memory = new Uint8Array(0x10000), io = null) {
    this.mem = memory;
    this.io = io;
    this.r = new Uint8Array(8);
    this.pc = 0;
    this.sp = 0;
    this.fz = false;
    this.fs = false;
    this.fp = false;
    this.fcy = false;
    this.fac = false;
    this.inte = false;
    this.halted = false;
    this.cycles = 0;
    // Latest bus state, for the front panel lamps.
    this.addrBus = 0;
    this.dataBus = 0;
    this.status = STATUS.MEMR | STATUS.M1 | STATUS.WO;
    // Overridable bus hook: called once per machine cycle.
    this.sample = null;
    // Set by the front panel PROTECT switch: writes into [protectFrom,
    // protectTo) are swallowed, the way a protected memory board ignores them.
    this.protect = false;
    this.protectFrom = 0;
    this.protectTo = 0;
  }

  reset() {
    this.pc = 0;
    this.halted = false;
    this.inte = false;
    this.cycles = 0;
  }

  // --- 16 bit register pairs -------------------------------------------------

  get bc() { return (this.r[B] << 8) | this.r[C]; }
  set bc(v) { this.r[B] = v >> 8; this.r[C] = v & 0xff; }
  get de() { return (this.r[D] << 8) | this.r[E]; }
  set de(v) { this.r[D] = v >> 8; this.r[E] = v & 0xff; }
  get hl() { return (this.r[H] << 8) | this.r[L]; }
  set hl(v) { this.r[H] = v >> 8; this.r[L] = v & 0xff; }

  get psw() {
    return (this.fs ? 0x80 : 0) | (this.fz ? 0x40 : 0) | (this.fac ? 0x10 : 0) |
      (this.fp ? 0x04 : 0) | 0x02 | (this.fcy ? 0x01 : 0);
  }

  set psw(v) {
    this.fs = (v & 0x80) !== 0;
    this.fz = (v & 0x40) !== 0;
    this.fac = (v & 0x10) !== 0;
    this.fp = (v & 0x04) !== 0;
    this.fcy = (v & 0x01) !== 0;
  }

  // --- bus -------------------------------------------------------------------

  #bus(addr, data, status) {
    this.addrBus = addr & 0xffff;
    this.dataBus = data & 0xff;
    this.status = status | (this.inte ? STATUS.INTE : 0) | (this.protect ? STATUS.PROT : 0);
    if (this.sample) this.sample(this);
  }

  /** Is this address currently write protected? */
  protected(addr) {
    return this.protect && addr >= this.protectFrom && addr < this.protectTo;
  }

  rd(addr, status = STATUS.MEMR | STATUS.WO) {
    const v = this.mem[addr & 0xffff];
    this.#bus(addr, v, status);
    return v;
  }

  wr(addr, val, status = 0) {
    addr &= 0xffff;
    if (!this.protected(addr)) this.mem[addr] = val & 0xff;
    this.#bus(addr, val, status);
  }

  #fetch() {
    const v = this.rd(this.pc, STATUS.MEMR | STATUS.M1 | STATUS.WO);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  #imm8() {
    const v = this.rd(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  #imm16() {
    const lo = this.#imm8();
    return (this.#imm8() << 8) | lo;
  }

  #push(v) {
    this.sp = (this.sp - 1) & 0xffff;
    this.wr(this.sp, v >> 8, STATUS.STACK);
    this.sp = (this.sp - 1) & 0xffff;
    this.wr(this.sp, v & 0xff, STATUS.STACK);
  }

  #pop() {
    const lo = this.rd(this.sp, STATUS.MEMR | STATUS.STACK | STATUS.WO);
    this.sp = (this.sp + 1) & 0xffff;
    const hi = this.rd(this.sp, STATUS.MEMR | STATUS.STACK | STATUS.WO);
    this.sp = (this.sp + 1) & 0xffff;
    return (hi << 8) | lo;
  }

  #get(i) { return i === M ? this.rd(this.hl) : this.r[i]; }
  #set(i, v) { if (i === M) this.wr(this.hl, v); else this.r[i] = v & 0xff; }

  // --- ALU -------------------------------------------------------------------

  #szp(v) {
    this.fz = v === 0;
    this.fs = (v & 0x80) !== 0;
    this.fp = PARITY[v] === 1;
  }

  #add(v, carry) {
    const a = this.r[A];
    const sum = a + v + carry;
    this.fac = ((a & 0x0f) + (v & 0x0f) + carry) > 0x0f;
    this.fcy = sum > 0xff;
    this.r[A] = sum & 0xff;
    this.#szp(this.r[A]);
  }

  #sub(v, borrow) {
    const a = this.r[A];
    const diff = a - v - borrow;
    // The 8080 stores the *complement* of the half borrow in AC.
    this.fac = ((a & 0x0f) - (v & 0x0f) - borrow) >= 0;
    this.fcy = diff < 0;
    this.r[A] = diff & 0xff;
    this.#szp(this.r[A]);
  }

  #cmp(v) {
    const a = this.r[A];
    this.#sub(v, 0);
    this.r[A] = a;
  }

  #ana(v) {
    const a = this.r[A];
    this.fac = ((a | v) & 0x08) !== 0; // 8080 quirk: OR of bit 3, not AND
    this.fcy = false;
    this.r[A] = a & v;
    this.#szp(this.r[A]);
  }

  #xra(v) {
    this.fac = false;
    this.fcy = false;
    this.r[A] ^= v;
    this.#szp(this.r[A]);
  }

  #ora(v) {
    this.fac = false;
    this.fcy = false;
    this.r[A] |= v;
    this.#szp(this.r[A]);
  }

  #inr(v) {
    const r = (v + 1) & 0xff;
    this.fac = (r & 0x0f) === 0;
    this.#szp(r);
    return r;
  }

  #dcr(v) {
    const r = (v - 1) & 0xff;
    this.fac = (r & 0x0f) !== 0x0f;
    this.#szp(r);
    return r;
  }

  #dad(v) {
    const sum = this.hl + v;
    this.fcy = sum > 0xffff;
    this.hl = sum & 0xffff;
  }

  #daa() {
    let a = this.r[A];
    let corr = 0;
    let cy = this.fcy;
    if (this.fac || (a & 0x0f) > 9) corr |= 0x06;
    if (cy || a > 0x99) { corr |= 0x60; cy = true; }
    this.fac = ((a & 0x0f) + (corr & 0x0f)) > 0x0f;
    a = (a + corr) & 0xff;
    this.r[A] = a;
    this.#szp(a);
    this.fcy = cy;
  }

  #cond(i) {
    switch (i) {
      case 0: return !this.fz;
      case 1: return this.fz;
      case 2: return !this.fcy;
      case 3: return this.fcy;
      case 4: return !this.fp;
      case 5: return this.fp;
      case 6: return !this.fs;
      case 7: return this.fs;
    }
  }

  /** Execute one instruction. Returns the number of clock cycles it took. */
  step() {
    if (this.halted) {
      // Keep the HLTA lamp alive while the panel is watching the bus.
      this.#bus(this.pc, 0x76, STATUS.MEMR | STATUS.M1 | STATUS.WO | STATUS.HLTA);
      this.cycles += 4;
      return 4;
    }

    const op = this.#fetch();
    let t = CYCLES[op];

    switch (op) {
      // --- 0x00..0x3f: misc, 16 bit ops, INR/DCR/MVI, rotates ---------------
      case 0x00: case 0x08: case 0x10: case 0x18:
      case 0x20: case 0x28: case 0x30: case 0x38: break; // NOP (and undocumented aliases)

      case 0x01: this.bc = this.#imm16(); break; // LXI B
      case 0x11: this.de = this.#imm16(); break; // LXI D
      case 0x21: this.hl = this.#imm16(); break; // LXI H
      case 0x31: this.sp = this.#imm16(); break; // LXI SP

      case 0x02: this.wr(this.bc, this.r[A]); break; // STAX B
      case 0x12: this.wr(this.de, this.r[A]); break; // STAX D
      case 0x0a: this.r[A] = this.rd(this.bc); break; // LDAX B
      case 0x1a: this.r[A] = this.rd(this.de); break; // LDAX D

      case 0x22: { // SHLD
        const a = this.#imm16();
        this.wr(a, this.r[L]);
        this.wr(a + 1, this.r[H]);
        break;
      }
      case 0x2a: { // LHLD
        const a = this.#imm16();
        this.r[L] = this.rd(a);
        this.r[H] = this.rd(a + 1);
        break;
      }
      case 0x32: this.wr(this.#imm16(), this.r[A]); break; // STA
      case 0x3a: this.r[A] = this.rd(this.#imm16()); break; // LDA

      case 0x03: this.bc = (this.bc + 1) & 0xffff; break; // INX B
      case 0x13: this.de = (this.de + 1) & 0xffff; break; // INX D
      case 0x23: this.hl = (this.hl + 1) & 0xffff; break; // INX H
      case 0x33: this.sp = (this.sp + 1) & 0xffff; break; // INX SP
      case 0x0b: this.bc = (this.bc - 1) & 0xffff; break; // DCX B
      case 0x1b: this.de = (this.de - 1) & 0xffff; break; // DCX D
      case 0x2b: this.hl = (this.hl - 1) & 0xffff; break; // DCX H
      case 0x3b: this.sp = (this.sp - 1) & 0xffff; break; // DCX SP

      case 0x09: this.#dad(this.bc); break; // DAD B
      case 0x19: this.#dad(this.de); break; // DAD D
      case 0x29: this.#dad(this.hl); break; // DAD H
      case 0x39: this.#dad(this.sp); break; // DAD SP

      case 0x07: { // RLC
        const a = this.r[A];
        this.fcy = (a & 0x80) !== 0;
        this.r[A] = ((a << 1) | (this.fcy ? 1 : 0)) & 0xff;
        break;
      }
      case 0x0f: { // RRC
        const a = this.r[A];
        this.fcy = (a & 0x01) !== 0;
        this.r[A] = ((a >> 1) | (this.fcy ? 0x80 : 0)) & 0xff;
        break;
      }
      case 0x17: { // RAL
        const a = this.r[A];
        const cy = this.fcy ? 1 : 0;
        this.fcy = (a & 0x80) !== 0;
        this.r[A] = ((a << 1) | cy) & 0xff;
        break;
      }
      case 0x1f: { // RAR
        const a = this.r[A];
        const cy = this.fcy ? 0x80 : 0;
        this.fcy = (a & 0x01) !== 0;
        this.r[A] = ((a >> 1) | cy) & 0xff;
        break;
      }

      case 0x27: this.#daa(); break;
      case 0x2f: this.r[A] = (~this.r[A]) & 0xff; break; // CMA
      case 0x37: this.fcy = true; break; // STC
      case 0x3f: this.fcy = !this.fcy; break; // CMC

      // --- 0x40..0x7f: MOV / HLT ---------------------------------------------
      case 0x76: this.halted = true; break; // HLT

      // --- 0xc0..0xff: control flow, immediates, stack ------------------------
      case 0xc3: case 0xcb: this.pc = this.#imm16(); break; // JMP
      case 0xcd: case 0xdd: case 0xed: case 0xfd: { // CALL
        const a = this.#imm16();
        this.#push(this.pc);
        this.pc = a;
        break;
      }
      case 0xc9: case 0xd9: this.pc = this.#pop(); break; // RET

      case 0xe3: { // XTHL
        const lo = this.rd(this.sp, STATUS.MEMR | STATUS.STACK | STATUS.WO);
        const hi = this.rd(this.sp + 1, STATUS.MEMR | STATUS.STACK | STATUS.WO);
        this.wr(this.sp, this.r[L], STATUS.STACK);
        this.wr(this.sp + 1, this.r[H], STATUS.STACK);
        this.r[L] = lo;
        this.r[H] = hi;
        break;
      }
      case 0xeb: { // XCHG
        const t2 = this.de;
        this.de = this.hl;
        this.hl = t2;
        break;
      }
      case 0xe9: this.pc = this.hl; break; // PCHL
      case 0xf9: this.sp = this.hl; break; // SPHL

      case 0xdb: // IN
        this.r[A] = this.io ? this.io.input(this.#imm8()) & 0xff : 0xff;
        this.#bus(this.addrBus, this.r[A], STATUS.INP | STATUS.WO);
        break;
      case 0xd3: { // OUT
        const port = this.#imm8();
        if (this.io) this.io.output(port, this.r[A]);
        this.#bus((port << 8) | port, this.r[A], STATUS.OUT);
        break;
      }

      case 0xf3: this.inte = false; break; // DI
      case 0xfb: this.inte = true; break; // EI

      default: {
        const hi = op & 0xc0;
        if (hi === 0x40) { // MOV r,r
          this.#set((op >> 3) & 7, this.#get(op & 7));
        } else if (hi === 0x80) { // ALU A,r
          this.#alu((op >> 3) & 7, this.#get(op & 7));
        } else if (hi === 0x00) {
          const sub = op & 7;
          const dst = (op >> 3) & 7;
          if (sub === 4) this.#set(dst, this.#inr(this.#get(dst)));
          else if (sub === 5) this.#set(dst, this.#dcr(this.#get(dst)));
          else if (sub === 6) this.#set(dst, this.#imm8()); // MVI
        } else { // 0xc0
          const sub = op & 7;
          const cc = (op >> 3) & 7;
          if (sub === 0) { // Rcc
            if (this.#cond(cc)) { this.pc = this.#pop(); t += 6; }
          } else if (sub === 2) { // Jcc
            const a = this.#imm16();
            if (this.#cond(cc)) this.pc = a;
          } else if (sub === 4) { // Ccc
            const a = this.#imm16();
            if (this.#cond(cc)) { this.#push(this.pc); this.pc = a; t += 6; }
          } else if (sub === 6) { // ALU A,imm
            this.#alu(cc, this.#imm8());
          } else if (sub === 7) { // RST n
            this.#push(this.pc);
            this.pc = op & 0x38;
          } else if (sub === 1) { // POP rp
            const v = this.#pop();
            switch ((op >> 4) & 3) {
              case 0: this.bc = v; break;
              case 1: this.de = v; break;
              case 2: this.hl = v; break;
              case 3: this.r[A] = v >> 8; this.psw = v & 0xff; break;
            }
          } else if (sub === 5) { // PUSH rp
            switch ((op >> 4) & 3) {
              case 0: this.#push(this.bc); break;
              case 1: this.#push(this.de); break;
              case 2: this.#push(this.hl); break;
              case 3: this.#push((this.r[A] << 8) | this.psw); break;
            }
          }
        }
      }
    }

    this.cycles += t;
    return t;
  }

  #alu(kind, v) {
    switch (kind) {
      case 0: this.#add(v, 0); break; // ADD
      case 1: this.#add(v, this.fcy ? 1 : 0); break; // ADC
      case 2: this.#sub(v, 0); break; // SUB
      case 3: this.#sub(v, this.fcy ? 1 : 0); break; // SBB
      case 4: this.#ana(v); break;
      case 5: this.#xra(v); break;
      case 6: this.#ora(v); break;
      case 7: this.#cmp(v); break;
    }
  }

  /** Run until at least `budget` clock cycles have elapsed. */
  run(budget) {
    const end = this.cycles + budget;
    while (this.cycles < end) this.step();
  }
}
