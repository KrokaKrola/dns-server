const dgram = require("dgram");

const udpSocket = dgram.createSocket("udp4");
udpSocket.bind(2053, "127.0.0.1");

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
    ancount = 0;
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

udpSocket.on("message", (buf, rinfo) => {
    try {
        const dnsHeader = new DnsHeader(buf);
        udpSocket.send(dnsHeader.packHeaderForResponse(), rinfo.port, rinfo.address);
    } catch (e) {
        console.log(`Error receiving data: ${e}`);
    }
});

udpSocket.on("error", (err) => {
    console.log(`Error: ${err}`);
});

udpSocket.on("listening", () => {
    const address = udpSocket.address();
    console.log(`Server listening ${address.address}:${address.port}`);
});
