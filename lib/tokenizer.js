class Tokenizer {
  constructor (src) {
    this.tokens = [];
    this.offset = 0;

    /* strip single line comments */
    src = src.replace(/\/\/.*$/mg, '');

    /* strip multi line comments */
    src = src.replace(/\/\*[\s\S]*?\*\//mg, '');

    /* split everything by whitespace, grouping quoted sections together */
    const tokenizer = /([^\s\n\r"]+)|"([^"]+)"/mg;
    let match;

    while ((match = tokenizer.exec(src)) !== null) {
      this.tokens.push(match[1] || match[2]);
    }
  }

  EOF () {
    if (this.tokens === null) {
      return true;
    }

    let token = this.tokens[this.offset];

    while (token === '' && this.offset < this.tokens.length) {
      this.offset++;
      token = this.tokens[this.offset];
    }

    return this.offset >= this.tokens.length;
  }

  next () {
    let token = '';

    if (this.tokens) {
      while (token === '' && this.offset < this.tokens.length) {
        token = this.tokens[this.offset++];
      }
    }

    return token;
  }

  prev () {
    let token = '';

    if (this.tokens) {
      while (token === '' && this.offset >= 0) {
        token = this.tokens[this.offset--];
      }
    }

    return token;
  }
}

export default Tokenizer;
export { Tokenizer };
