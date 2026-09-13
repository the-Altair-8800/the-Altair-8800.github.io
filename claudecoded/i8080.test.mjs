/**
 * Tests for the 8080 core: `node i8080.test.mjs`
 *
 * Flags, the awkward corners (DAA, the AC complement on subtract, the ANA bit 3
 * quirk), conditional cycle counts, the stack, and two real programs.
 */

import { I8080 } from './i8080.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${name}: got ${got}, want ${want}`); }
};

const mk = (bytes, io) => {
  const cpu = new I8080(new Uint8Array(0x10000), io);
  bytes.forEach((b, i) => cpu.mem[i] = b);
  return cpu;
};
const flags = c => `${c.fs?'S':'-'}${c.fz?'Z':'-'}${c.fac?'A':'-'}${c.fp?'P':'-'}${c.fcy?'C':'-'}`;

// --- ADD/flags ---------------------------------------------------------------
// MVI A,0x2E ; MVI B,0x6C ; ADD B   -> A=0x9A, S=1 Z=0 AC=1 P=1 CY=0
let c = mk([0x3e,0x2e, 0x06,0x6c, 0x80]);
c.step(); c.step(); c.step();
eq('ADD result', c.r[7], 0x9a);
eq('ADD flags', flags(c), 'S-AP-');

// SUB A with A=0x3E -> 0, Z=1, AC=1 (complement of half borrow), P=1, CY=0
c = mk([0x3e,0x3e, 0x97]);
c.step(); c.step();
eq('SUB A result', c.r[7], 0x00);
eq('SUB A flags', flags(c), '-ZAP-');

// 0x00 - 0x01 -> 0xFF with borrow
c = mk([0x3e,0x00, 0xd6,0x01]);
c.step(); c.step();
eq('SUI borrow result', c.r[7], 0xff);
eq('SUI borrow flags', flags(c), 'S--PC'); // 0xFF has even parity

// --- DAA ---------------------------------------------------------------------
// Classic 8080 manual example: A=0x9B, DAA -> A=0x01, CY=1, AC=1
c = mk([0x3e,0x9b, 0x27]);
c.step(); c.step();
eq('DAA 0x9B', c.r[7], 0x01);
eq('DAA 0x9B CY', c.fcy, true);
eq('DAA 0x9B AC', c.fac, true);

// BCD 38 + 45 = 83
c = mk([0x3e,0x38, 0xc6,0x45, 0x27]);
c.step(); c.step(); c.step();
eq('DAA 38+45', c.r[7].toString(16), '83');
eq('DAA 38+45 CY', c.fcy, false);

// BCD 89 + 76 = 165 -> 0x65 with carry
c = mk([0x3e,0x89, 0xc6,0x76, 0x27]);
c.step(); c.step(); c.step();
eq('DAA 89+76', c.r[7].toString(16), '65');
eq('DAA 89+76 CY', c.fcy, true);

// --- rotates -----------------------------------------------------------------
c = mk([0x3e,0xf2, 0x0f]);            // RRC 0xF2 -> 0x79, CY=0
c.step(); c.step();
eq('RRC', c.r[7], 0x79); eq('RRC CY', c.fcy, false);
c = mk([0x3e,0xb5, 0x07]);            // RLC 0xB5 -> 0x6B, CY=1
c.step(); c.step();
eq('RLC', c.r[7], 0x6b); eq('RLC CY', c.fcy, true);
c = mk([0x3e,0x6a, 0x37, 0x1f]);      // STC then RAR 0x6A -> 0xB5, CY=0
c.step(); c.step(); c.step();
eq('RAR', c.r[7], 0xb5); eq('RAR CY', c.fcy, false);

// --- ANA quirk: AC = OR of bit 3 --------------------------------------------
c = mk([0x3e,0x08, 0x06,0x00, 0xa0]); // A=08 AND B=00
c.step(); c.step(); c.step();
eq('ANA AC quirk', c.fac, true);
eq('ANA result', c.r[7], 0x00);

// --- INR/DCR do not touch carry ---------------------------------------------
c = mk([0x37, 0x3e,0xff, 0x3c]);      // STC ; MVI A,FF ; INR A
c.step(); c.step(); c.step();
eq('INR wrap', c.r[7], 0x00);
eq('INR keeps CY', c.fcy, true);
eq('INR AC', c.fac, true);

// --- stack, CALL/RET, PUSH/POP PSW ------------------------------------------
c = mk([0x31,0x00,0x40, 0xcd,0x20,0x00, 0x76, ...Array(0x20-7).fill(0), 0x3e,0x42, 0xc9]);
c.step(); // LXI SP
c.step(); // CALL
eq('CALL pc', c.pc, 0x20);
eq('CALL pushed', (c.mem[0x3fff]<<8)|c.mem[0x3ffe], 0x0006);
c.step(); c.step(); // MVI A,42 ; RET
eq('RET pc', c.pc, 0x06);
eq('RET sp', c.sp, 0x4000);

c = mk([0x31,0x00,0x40, 0x3e,0x80, 0xc6,0x80, 0xf5, 0x3e,0x00, 0xf1]);
c.step(); c.step(); c.step(); c.step();  // A=0x00 after 0x80+0x80, CY=1 Z=1 P=1
const savedPsw = c.psw, savedA = c.r[7];
c.step(); c.step();                      // MVI A,0 ; POP PSW
eq('POP PSW a', c.r[7], savedA);
eq('POP PSW flags', c.psw, savedPsw);
eq('PSW bit1 always set', (c.psw & 0x02) !== 0, true);

// --- XTHL / XCHG -------------------------------------------------------------
c = mk([0x31,0x00,0x40, 0x21,0x34,0x12, 0x11,0x78,0x56, 0xd5, 0xe3]);
c.step(); c.step(); c.step(); c.step(); c.step();
eq('XTHL hl', c.hl.toString(16), '5678');
eq('XTHL top of stack', ((c.mem[c.sp+1]<<8)|c.mem[c.sp]).toString(16), '1234');

// --- conditional cycle counts ------------------------------------------------
c = mk([0xc4,0x10,0x00]);  // CNZ, Z clear -> taken, 17 cycles
eq('CNZ taken cycles', c.step(), 17);
c = mk([0xcc,0x10,0x00]);  // CZ, Z clear -> not taken, 11 cycles
eq('CZ untaken cycles', c.step(), 11);
c = mk([0xc0]);            // RNZ taken -> 11
eq('RNZ taken cycles', c.step(), 11);
c = mk([0xc8]);            // RZ not taken -> 5
eq('RZ untaken cycles', c.step(), 5);
c = mk([0xc2,0x10,0x00]);  // JNZ -> 10 either way
eq('JNZ cycles', c.step(), 10);

// --- a real program: sum 1..10 via a DCR loop, 16-bit result in HL -----------
c = mk([
  0x21,0x00,0x00,       // LXI H,0
  0x06,0x0a,            // MVI B,10
  0x78,                 // loop: MOV A,B
  0x85,                 //       ADD L
  0x6f,                 //       MOV L,A
  0x7c,                 //       MOV A,H
  0xce,0x00,            //       ACI 0
  0x67,                 //       MOV H,A
  0x05,                 //       DCR B
  0xc2,0x05,0x00,       //       JNZ loop
  0x76,                 // HLT
]);
for (let i = 0; i < 200 && !c.halted; i++) c.step();
eq('sum 1..10', c.hl, 55);
eq('halted', c.halted, true);

// --- IN/OUT ------------------------------------------------------------------
const seen = [];
c = mk([0xdb,0xff, 0xd3,0x10, 0x76], {
  input: p => (seen.push(['in', p]), 0xa5),
  output: (p, v) => seen.push(['out', p, v]),
});
c.step(); c.step();
eq('IN value', c.r[7], 0xa5);
eq('IN port', seen[0][1], 0xff);
eq('OUT port', seen[1][1], 0x10);
eq('OUT value', seen[1][2], 0xa5);

// --- Kill the Bit: the rotating bit must actually rotate ---------------------
let sense = 0x00;
const ktb = mk([
  0x21,0x00,0x00, 0x16,0x80, 0x01,0x0e,0x00,
  0x1a, 0x1a, 0x1a, 0x1a, 0x09, 0xd2,0x08,0x00,
  0xdb,0xff, 0xaa, 0x0f, 0x57, 0xc3,0x08,0x00,
], { input: () => sense, output: () => {} });
const pattern = [];
let last = ktb.r[2];
for (let i = 0; i < 4_000_000 && pattern.length < 5; i++) {
  ktb.step();
  if (ktb.r[2] !== last) { last = ktb.r[2]; pattern.push(last.toString(16)); }
}
eq('kill-the-bit rotates', pattern.join(','), '80,40,20,10,8');

// Flip the matching sense switch for exactly one pass, then flip it back down:
// holding it up would just inject a fresh bit, exactly like the real machine.
let armed = true, fired = false;
for (let i = 0; i < 1_000_000; i++) {
  if (armed && ktb.pc === 0x10) { sense = ktb.r[2]; armed = false; fired = true; }
  else if (fired && ktb.pc === 0x12) { sense = 0; fired = false; }
  ktb.step();
}
eq('kill-the-bit can be killed', ktb.r[2], 0x00);

// --- bus sampling feeds the lamps -------------------------------------------
c = mk([0x1a]);             // LDAX D with DE=0x8000 puts 0x8000 on the address bus
c.de = 0x8000;
const addrs = [];
c.sample = cpu => addrs.push(cpu.addrBus);
c.step();
eq('bus sees fetch then operand', addrs.join(','), '0,32768');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
