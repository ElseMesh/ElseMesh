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

static uint32_t read_u32_le(const std::vector<uint8_t> &bytes, size_t offset) {
    return static_cast<uint32_t>(bytes[offset])
        | (static_cast<uint32_t>(bytes[offset + 1]) << 8)
        | (static_cast<uint32_t>(bytes[offset + 2]) << 16)
        | (static_cast<uint32_t>(bytes[offset + 3]) << 24);
}

static bool encode(uint32_t flags, OutputBuffer &output) {
    constexpr uint32_t width = 64;
    constexpr uint32_t height = 64;
    std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4, 127);
    std::array<char, 256> error{};
    const int status = em_ktx2_encode_rgba8_stream(pixels.data(), pixels.size(), width, height,
        width * 4, flags, append_chunk, &output, error.data(), error.size());
    if (status != 0) std::fprintf(stderr, "encode failed (%d): %s\n", status, error.data());
    return status == 0;
}

int main() {
    OutputBuffer encoded;
    if (!encode(1u, encoded)) return 1;
    if (encoded.bytes.size() < 12 || encoded.bytes[0] != 0xAB || encoded.bytes[1] != 0x4B ||
        encoded.bytes[2] != 0x54 || encoded.bytes[3] != 0x58 || encoded.bytes[4] != 0x20 ||
        encoded.bytes[5] != 0x32 || encoded.bytes[6] != 0x30 || encoded.bytes[7] != 0xBB ||
        encoded.bytes[8] != 0x0D || encoded.bytes[9] != 0x0A || encoded.bytes[10] != 0x1A || encoded.bytes[11] != 0x0A) {
        std::fprintf(stderr, "encoder returned data without a KTX2 file signature\n");
        return 1;
    }
    if (encoded.bytes.size() < 80 || read_u32_le(encoded.bytes, 40) <= 1) {
        std::fprintf(stderr, "default encoding did not produce a generated mip chain\n");
        return 1;
    }
    OutputBuffer sourceLevelOnly;
    if (!encode(1u | (1u << 2), sourceLevelOnly)) return 1;
    if (sourceLevelOnly.bytes.size() < 80 || read_u32_le(sourceLevelOnly.bytes, 40) != 1) {
        std::fprintf(stderr, "single-source-level encoding returned an unexpected KTX2 level count\n");
        return 1;
    }
    return 0;
}
