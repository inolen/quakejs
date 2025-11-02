function rol (num, cnt) {
  return ((num << cnt) | (num >>> (32 - cnt))) >>> 0;
}

function add (x, y) {
  return ((x >>> 0) + (y >>> 0)) >>> 0;
}

function hh (a, b, c, d, x, s) {
  const q = b ^ c ^ d;
  return rol(add(add(add(a, q), x), 0x6ed9eba1), s);
}

function gg (a, b, c, d, x, s) {
  const q = (b & c) | (b & d) | (c & d);
  return rol(add(add(add(a, q), x), 0x5a827999), s);
}

function ff (a, b, c, d, x, s) {
  const q = (b & c) | (~b & d);
  return rol(add(add(a, q), x), s);
}

function md4 (x) {
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  /* pad the end */
  const numBits = x.length * 32;

  x[x.length] |= 0x80 << (numBits % 32);
  x[((x.length + 2) & ~15) + 14] = numBits;

  /* work in 64 byte chunks */
  for (let i = 0; i < x.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;

    /* round 1 */
    a = ff(a, b, c, d, x[i + 0], 3); d = ff(d, a, b, c, x[i + 1], 7); c = ff(c, d, a, b, x[i + 2], 11); b = ff(b, c, d, a, x[i + 3], 19);
    a = ff(a, b, c, d, x[i + 4], 3); d = ff(d, a, b, c, x[i + 5], 7); c = ff(c, d, a, b, x[i + 6], 11); b = ff(b, c, d, a, x[i + 7], 19);
    a = ff(a, b, c, d, x[i + 8], 3); d = ff(d, a, b, c, x[i + 9], 7); c = ff(c, d, a, b, x[i + 10], 11); b = ff(b, c, d, a, x[i + 11], 19);
    a = ff(a, b, c, d, x[i + 12], 3); d = ff(d, a, b, c, x[i + 13], 7); c = ff(c, d, a, b, x[i + 14], 11); b = ff(b, c, d, a, x[i + 15], 19);

    /* round 2 */
    a = gg(a, b, c, d, x[i + 0], 3); d = gg(d, a, b, c, x[i + 4], 5); c = gg(c, d, a, b, x[i + 8], 9); b = gg(b, c, d, a, x[i + 12], 13);
    a = gg(a, b, c, d, x[i + 1], 3); d = gg(d, a, b, c, x[i + 5], 5); c = gg(c, d, a, b, x[i + 9], 9); b = gg(b, c, d, a, x[i + 13], 13);
    a = gg(a, b, c, d, x[i + 2], 3); d = gg(d, a, b, c, x[i + 6], 5); c = gg(c, d, a, b, x[i + 10], 9); b = gg(b, c, d, a, x[i + 14], 13);
    a = gg(a, b, c, d, x[i + 3], 3); d = gg(d, a, b, c, x[i + 7], 5); c = gg(c, d, a, b, x[i + 11], 9); b = gg(b, c, d, a, x[i + 15], 13);

    /* round 3 */
    a = hh(a, b, c, d, x[i + 0], 3); d = hh(d, a, b, c, x[i + 8], 9); c = hh(c, d, a, b, x[i + 4], 11); b = hh(b, c, d, a, x[i + 12], 15);
    a = hh(a, b, c, d, x[i + 2], 3); d = hh(d, a, b, c, x[i + 10], 9); c = hh(c, d, a, b, x[i + 6], 11); b = hh(b, c, d, a, x[i + 14], 15);
    a = hh(a, b, c, d, x[i + 1], 3); d = hh(d, a, b, c, x[i + 9], 9); c = hh(c, d, a, b, x[i + 5], 11); b = hh(b, c, d, a, x[i + 13], 15);
    a = hh(a, b, c, d, x[i + 3], 3); d = hh(d, a, b, c, x[i + 11], 9); c = hh(c, d, a, b, x[i + 7], 11); b = hh(b, c, d, a, x[i + 15], 15);

    a = add(a, olda);
    b = add(b, oldb);
    c = add(c, oldc);
    d = add(d, oldd);
  }

  return [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
}

function checksum (buffer) {
  let view;

  if (buffer instanceof ArrayBuffer) {
    view = new DataView(buffer);
  } else {
    view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  /* generate a list of file checksums in the pak */
  const crcs = [];
  let offset = 0;

  while (offset + 30 <= buffer.byteLength) {
    const sig = view.getUint32(offset, true);

    /* local file header signature */
    if (sig !== 0x04034b50) {
      break;
    }

    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    if (uncompressedSize > 0) {
      crcs.push(crc);
    }

    offset += 30 + filenameLength + compressedSize + extraFieldLength;
  }

  /* generate a checksum of the list of file checksums */
  const digest = md4(crcs);

  return (digest[0] ^ digest[1] ^ digest[2] ^ digest[3]) >>> 0;
}

export default { checksum };
export { checksum };
