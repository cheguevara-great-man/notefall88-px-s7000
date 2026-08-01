from host.protocol import TYPE_FRAME, StreamDecoder, encode_logical_frame, encode_packet


def sample_frame():
    return [[(row * 20, note * 10, 7) for note in range(12)] for row in range(4)]


def test_packet_round_trip_in_arbitrary_chunks():
    raw = encode_logical_frame(42, sample_frame(), 4)
    decoder = StreamDecoder()
    packets = []
    for at in range(0, len(raw), 7):
        packets.extend(decoder.feed(raw[at : at + 7]))
    assert len(packets) == 1
    assert packets[0].message_type == TYPE_FRAME
    assert packets[0].sequence == 42
    assert packets[0].payload[:4] == bytes((4, 4, 12, 0))


def test_corrupt_packet_is_skipped_and_next_packet_recovers():
    broken = bytearray(encode_packet(0x01, 1, b"hello"))
    broken[-1] ^= 0x55
    valid = encode_packet(0x01, 2, b"world")
    decoder = StreamDecoder()
    packets = decoder.feed(b"noise" + broken + valid)
    assert [packet.sequence for packet in packets] == [2]
    assert decoder.crc_errors == 1

