#include "elsemesh_ktx2.h"

#include <array>
#include <cstdio>
#include <vector>

struct OutputBuffer { std::vector<uint8_t> bytes; };

static int append_chunk(const uint8_t *chunk, size_t chunk_bytes, void *user_data) {
    auto *output = static_cast<OutputBuffer *>(user_data);
    output->bytes.insert(output->bytes.end(), chunk, chunk + chunk_bytes);
    return 0;
}

int main() {
    constexpr uint32_t width = 64;
    constexpr uint32_t height = 64;
    std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4);
    for (uint32_t y = 0; y < height; ++y) {
        for (uint32_t x = 0; x < width; ++x) {
            const size_t offset = (static_cast<size_t>(y) * width + x) * 4;
            pixels[offset + 0] = static_cast<uint8_t>(x * 4);
            pixels[offset + 1] = static_cast<uint8_t>(y * 4);
            pixels[offset + 2] = 127;
            pixels[offset + 3] = 255;
        }
    }

    OutputBuffer encoded;
    std::array<char, 256> error{};
    const int status = em_ktx2_encode_rgba8_stream(pixels.data(), pixels.size(), width, height,
        width * 4, 1u, append_chunk, &encoded, error.data(), error.size());
    if (status != 0) {
        std::fprintf(stderr, "encode failed (%d): %s\n", status, error.data());
        return 1;
    }
    if (encoded.bytes.size() < 12 || encoded.bytes[0] != 0xAB || encoded.bytes[1] != 0x4B ||
        encoded.bytes[2] != 0x54 || encoded.bytes[3] != 0x58 || encoded.bytes[4] != 0x20 ||
        encoded.bytes[5] != 0x32 || encoded.bytes[6] != 0x30 || encoded.bytes[7] != 0xBB ||
        encoded.bytes[8] != 0x0D || encoded.bytes[9] != 0x0A || encoded.bytes[10] != 0x1A || encoded.bytes[11] != 0x0A) {
        std::fprintf(stderr, "encoder returned data without a KTX2 file signature\n");
        return 1;
    }
    return 0;
}
