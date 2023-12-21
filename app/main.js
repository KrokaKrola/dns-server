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
     * @type {DnsQuestions}
     */
    dnsQuestions = null;

    /**
     *
     * @type {DnsAnswer[]}
     */
    dnsAnswers = null;

    constructor(dnsHeader, dnsQuestions, dnsAnswers) {
        this.header = dnsHeader;
        this.dnsQuestions = dnsQuestions;
        this.dnsAnswers = dnsAnswers;
    }

    packMessage() {
        const header = new Uint8Array(this.header.packHeaderForResponse());
        const questions = this.dnsQuestions.questions.map(q => {
            return new Uint8Array(this.dnsQuestions.packQuestionForResponse(q.qname, q.qtype, q.qclass));
        })
        const answers = this.dnsAnswers.map(a => {
            return new Uint8Array(a.packAnswerForResponse());
        });

        return Buffer.concat([header, ...questions, ...answers]);
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
    qdcount = 0;
    ancount = 1;
    nscount = 0;
    arcount = 0;

    /**
     * Buffer from message
     * @param buf {Buffer}
     */
    constructor(buf) {
        this.id = buf.readUInt16BE(0);
        const flags = this.#parseFlagsByte(buf.readUInt16BE(2));
        this.qr = flags.qr;
        this.opcode = flags.opcode;
        this.aa = flags.aa;
        this.tc = flags.tc;
        this.rd = flags.rd;
        this.ra = flags.ra;
        this.z = flags.z;
        this.rcode = flags.rcode;
        this.qdcount = buf.readUInt16BE(4);
        this.ancount = this.qdcount;
    }

    #parseFlagsByte(byte) {
        return {
            qr: byte >> 15,
            opcode: (byte >> 11) & 0b1111,
            aa: (byte >> 10) & 1,
            tc: (byte >> 9) & 1,
            rd: (byte >> 8) & 1,
            ra: (byte >> 7) & 1,
            z: (byte >> 4) & 0b111,
            rcode: byte & 0b1111,
        };
    }

    #packFlagsByte(qr, rcode) {
        return (qr << 15) |
            (this.opcode << 11) |
            (this.aa << 10) |
            (this.tc << 9) |
            (this.rd << 8) |
            (this.ra << 7) |
            (this.z << 4) |
            rcode;
    }

    packHeaderForResponse() {
        const buf = Buffer.alloc(12);
        const rCode = 4;
        const qr = 1;
        buf.writeUInt16BE(this.id, 0);
        buf.writeUInt16BE(this.#packFlagsByte(qr, rCode), 2);
        buf.writeUInt16BE(this.qdcount, 4);
        buf.writeUInt16BE(this.ancount, 6);
        buf.writeUInt16BE(this.nscount, 8);
        buf.writeUInt16BE(this.arcount, 10);
        return buf;
    }
}

class DnsQuestions {
    #questions = [];
    questionCount = 0;

    constructor(packetBuffer, questionCount) {
        this.questionCount = questionCount;
        this.parse(packetBuffer);
    }

    #parseDomainName(packet, offset) {
        let domain = '';
        let length = packet.readUInt8(offset);

        while (length !== 0) {
            domain += packet.toString('utf-8', offset + 1, offset + 1 + length) + '.';
            offset += length + 1;
            length = packet.readUInt8(offset);
        }

        domain = domain.slice(0, -1); // Remove the last dot

        return {domain, offset: offset + 1};
    }

    #parseQuestion(packet, offset) {
        const {domain, offset: newOffset} = this.#parseDomainName(packet, offset);
        const qtype = packet.readUInt16BE(newOffset);
        const qclass = packet.readUInt16BE(newOffset + 2);

        return {qname: domain, qtype, qclass, offset: newOffset + 4};
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

    packQuestionForResponse(qname, qtype, qclass) {
        const domain = this.#encodeDomainName(qname);
        const buffer = Buffer.alloc(domain.length + 4); // +4 for the 2 bytes of qtype and 2 bytes of qclass
        domain.copy(buffer); // copy the encoded domain name to the buffer
        let offset = domain.length;
        buffer.writeUInt16BE(qtype, offset);
        offset += 2;
        buffer.writeUInt16BE(qclass, offset);
        // console.log(qname, buffer);
        return buffer;
    }

    parse(packetBuffer) {
        let offset = 0; // Skip DNS header

        const that = this;

        if (this.questionCount === 1) {
            const question = this.#parseQuestion(packetBuffer, offset);
            this.#questions.push(question);
        } else {
            const question = this.#parseQuestion(packetBuffer, offset);
            this.#questions.push(question);
            offset = question.offset;

            while (that.#questions.length < that.questionCount) {
                if (offset >= packetBuffer.length) {
                    break;
                }

                const byte = packetBuffer.readUInt8(offset);
                if ((byte & 0xC0) === 0xC0) {
                    const pointerOffset = (byte << 8) | packetBuffer.readUInt8(offset + 1);
                    this.#questions.push(this.#parseQuestion(packetBuffer, (pointerOffset & 0x3FFF) - 16));
                } else {
                    offset++;
                }
            }
        }
    }

    get questions() {
        return this.#questions;
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
        const dnsQuestion = new DnsQuestions(buf.subarray(12), dnsHeader.qdcount);
        const dnsAnswers = dnsQuestion.questions.map(q => {
            return new DnsAnswer(q.qname);
        });

        const message = new DnsMessage(dnsHeader, dnsQuestion, dnsAnswers);
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
