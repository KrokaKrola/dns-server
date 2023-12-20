const dgram = require("dgram");

const udpSocket = dgram.createSocket("udp4");
udpSocket.bind(2053, "127.0.0.1");

class DnsMessage {
    /**
     *
     * @type {DnsHeader}
     */
    header = null;

    /**
     *
     * @type {DnsQuestion[]}
     */
    questions = [];

    /**
     *
     * @type {DnsAnswer}
     */
    dnsAnswer = null;

    constructor(dnsHeader, dnsQuestions, dnsAnswer) {
        this.header = dnsHeader;
        this.questions = dnsQuestions;
        this.dnsAnswer = dnsAnswer;
    }

    packMessage() {
        const header = new Uint8Array(this.header.packHeaderForResponse());
        const question = new Uint8Array(this.questions[0].packQuestionForResponse());
        const answer = new Uint8Array(this.dnsAnswer.packAnswerForResponse());

        return Buffer.concat([header, question, answer]);
    }

}

class DnsHeader {
    id = 0;
    qr = 0;
    opcode = 0;
    aa = 0;
    tc = 0;
    rd = 0;
    ra = 0;
    z = 0;
    rcode = 0;
    // assuming that we always have 1 question
    qdcount = 1;
    ancount = 1;
    nscount = 0;
    arcount = 0;

    /**
     * Buffer from message
     * @param buf {Buffer}
     */
    constructor(buf) {
        this.id = buf.readUInt16BE(0);
        const flags = buf.readUInt16BE(2);
        this.qr = flags >> 15;
        this.opcode = (flags >> 11) & 0b1111;
        this.aa = (flags >> 10) & 1;
        this.tc = (flags >> 9) & 1;
        this.rd = (flags >> 8) & 1;
        this.ra = (flags >> 7) & 1;
        this.z = (flags >> 4) & 0b111;
        this.rcode = flags & 0b1111;
    }

    packHeaderForResponse() {
        const buf = Buffer.alloc(12);
        buf.writeUInt16BE(this.id, 0);
        buf.writeUInt16BE(
            (1 << 15) |
            (this.opcode << 11) |
            (this.aa << 10) |
            (this.tc << 9) |
            (this.rd << 8) |
            (this.ra << 7) |
            (this.z << 4) |
            this.rcode,
            2
        );
        buf.writeUInt16BE(this.qdcount, 4);
        buf.writeUInt16BE(this.ancount, 6);
        buf.writeUInt16BE(this.nscount, 8);
        buf.writeUInt16BE(this.arcount, 10);
        return buf;
    }
}

class DnsQuestion {
    qname = "";
    qtype = 0;
    qclass = 0;

    /**
     *
     * @param buf {Buffer}
     */
    constructor(buf) {

        let offset = 0;
        let length = buf.readUInt8(offset);
        const labels = [];

        while (length !== 0) {
            // increment offset because length of label is stored in first byte
            offset++;
            labels.push(buf.toString('utf-8', offset, offset + length));
            offset += length;
            length = buf.readUInt8(offset);
        }

        this.qname = labels.join('.');
        // offset to move over empty byte \x00
        offset++;

        this.qclass = buf.readUInt16BE(offset);

        // qclass = 2 byte, move offset
        offset += 2;
        this.qtype = buf.readUInt16BE(offset);
    }

    #encodeDomainName(domain) {
        const labels = domain.split('.');
        const buffer = Buffer.alloc(domain.length + 2); // +2 for the null byte and extra length byte
        let offset = 0;

        labels.forEach(label => {
            buffer.writeUInt8(label.length, offset++);
            buffer.write(label, offset);
            offset += label.length;
        });

        buffer.writeUInt8(0, offset); // Null byte to terminate the domain name
        return buffer;
    }

    packQuestionForResponse() {
        const domain = this.#encodeDomainName(this.qname);
        const buffer = Buffer.alloc(domain.length + 4); // +4 for the 2 bytes of qtype and 2 bytes of qclass
        domain.copy(buffer); // copy the encoded domain name to the buffer
        let offset = domain.length;
        buffer.writeUInt16BE(this.qtype, offset);
        offset += 2;
        buffer.writeUInt16BE(this.qclass, offset);

        return buffer;
    }
}

class DnsAnswer {
    name = "";
    type = 1; // type A
    class = 1; // type IN
    ttl = 60;
    rdata = new Buffer.from([8, 8, 8, 8]).toString();

    constructor(name) {
        this.name = name;
    }

    #encodeName(string) {
        const labels = string.split('.');
        const buffer = Buffer.alloc(string.length + 2); // +2 for the null byte and extra length byte
        let offset = 0;

        labels.forEach(label => {
            buffer.writeUInt8(label.length, offset++);
            buffer.write(label, offset);
            offset += label.length;
        });

        buffer.writeUInt8(0, offset); // Null byte to terminate the domain name
        return buffer;
    }

    packAnswerForResponse() {
        const domain = this.#encodeName(this.name);
        // domain length + 2 bytes for type,
        // + 2 bytes for class,
        // + 4 bytes for ttl,
        // + 2 bytes for rdata length,
        // + 4 for rdata length
        const buffer = Buffer.alloc(domain.length + 14);
        domain.copy(buffer); // copy the encoded domain name to the buffer
        let offset = domain.length;
        buffer.writeUInt16BE(this.type, offset);
        offset += 2;
        buffer.writeUInt16BE(this.class, offset);
        offset += 2;
        buffer.writeUint32BE(this.ttl, offset);
        offset += 4;
        buffer.writeUInt16BE(this.rdata.length, offset);
        offset += 2;
        buffer.write(this.rdata, offset);

        return buffer;
    }
}

udpSocket.on("message", (buf, rinfo) => {
    try {
        const dnsHeader = new DnsHeader(buf.subarray(0, 12));
        const dnsQuestion = new DnsQuestion(buf.subarray(12));
        const dnsAnswer = new DnsAnswer(dnsQuestion.qname);

        const message = new DnsMessage(dnsHeader, [dnsQuestion], dnsAnswer);
        udpSocket.send(message.packMessage(), rinfo.port, rinfo.address);
    } catch (e) {
        console.log(`Error receiving data: ${e}`);
        console.log(e.stack);
    }
});

udpSocket.on("error", (err) => {
    console.log(`Error: ${err}`);
});

udpSocket.on("listening", () => {
    const address = udpSocket.address();
    console.log(`Server listening ${address.address}:${address.port}`);
});
