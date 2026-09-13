/**
 * Programs you would otherwise toggle in by hand, one switch flick per bit.
 *
 * `origin` is where the bytes go, `start` is the address to EXAMINE before
 * hitting RUN. Every listing is the real thing, in 8080 machine code.
 */

export const PROGRAMS = [
  {
    name: "Kill the Bit",
    origin: 0x0000,
    start: 0x0000,
    blurb:
      "Dean McDaniel's 1975 game, and the reason anyone remembers front panels " +
      "fondly. A single bit rotates through the upper address lamps. Flick the " +
      "sense switch underneath it to kill it - and flick it straight back down, " +
      "because a switch left up just injects another bit.",
    listing: [
      "LXI  H,0000     ; the delay counter",
      "MVI  D,80       ; the bit, top of the upper byte",
      "LXI  B,000E     ; delay step - smaller is faster",
      "LOOP: LDAX D    ; four dummy reads park D on the address bus,",
      "      LDAX D    ; which is what lights the upper address lamps",
      "      LDAX D",
      "      LDAX D",
      "      DAD  B    ; tick the delay",
      "      JNC  LOOP",
      "      IN   FF   ; read the sense switches",
      "      XRA  D    ; a matching switch cancels the bit",
      "      RRC       ; rotate whatever is left",
      "      MOV  D,A",
      "      JMP  LOOP",
    ],
    bytes: [
      0x21, 0x00, 0x00, 0x16, 0x80, 0x01, 0x0e, 0x00,
      0x1a, 0x1a, 0x1a, 0x1a, 0x09, 0xd2, 0x08, 0x00,
      0xdb, 0xff, 0xaa, 0x0f, 0x57, 0xc3, 0x08, 0x00,
    ],
  },
  {
    name: "Count",
    origin: 0x0000,
    start: 0x0000,
    blurb:
      "A 16 bit counter on the address lamps. The low bits blur into a steady " +
      "glow, the high bits step - which is exactly how you learn to read a " +
      "front panel at speed.",
    listing: [
      "LXI  H,0000",
      "LOOP: INX  H",
      "      MOV  A,M  ; put HL on the address bus so the lamps show it",
      "      JMP  LOOP",
    ],
    bytes: [0x21, 0x00, 0x00, 0x23, 0x7e, 0xc3, 0x03, 0x00],
  },
  {
    name: "Echo sense switches",
    origin: 0x0000,
    start: 0x0000,
    blurb:
      "Copies the eight sense switches (the upper half of the switch bank) onto " +
      "both halves of the address lamps, continuously. Flip a switch and watch " +
      "two lamps answer.",
    listing: [
      "LOOP: IN   FF",
      "      MOV  L,A",
      "      MOV  H,A",
      "      MOV  A,M  ; address bus = HL = switches in both bytes",
      "      JMP  LOOP",
    ],
    bytes: [0xdb, 0xff, 0x6f, 0x67, 0x7e, 0xc3, 0x00, 0x00],
  },
  {
    name: "Add two bytes",
    origin: 0x0000,
    start: 0x0000,
    blurb:
      "The arithmetic example from the Altair operator's manual. Deposit an " +
      "addend at 0080 and another at 0081, run it, then EXAMINE 0082 to read " +
      "the sum off the data lamps. It halts when it is done - watch HLTA light.",
    listing: [
      "LDA  0080",
      "MOV  B,A",
      "LDA  0081",
      "ADD  B",
      "STA  0082",
      "HLT",
    ],
    bytes: [0x3a, 0x80, 0x00, 0x47, 0x3a, 0x81, 0x00, 0x80, 0x32, 0x82, 0x00, 0x76],
  },
];
