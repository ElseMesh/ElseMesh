#include "elsemesh_ktx2.h"

#include "basisu_comp.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <exception>
#include <mutex>
#include <thread>

namespace {

constexpr uint32_t kSrgb = 1u << 0;
constexpr uint32_t kNormalMap = 1u << 1;
constexpr uint32_t kNoMipGeneration = 1u << 2;
constexpr uint32_t kKnownFlags = kSrgb | kNormalMap | kNoMipGeneration;
constexpr size_t kMaxInputBytes = 256u * 1024u * 1024u;
constexpr uint32_t kMaxDimension = 16384;
constexpr uint32_t kMaxEncoderThreads = 4;

std::once_flag encoderInitOnce;
bool encoderInitSucceeded = false;
std::mutex encodeMutex;

void set_error(char *buffer, size_t capacity, const char *message) {
    if (buffer == nullptr || capacity == 0) return;
    std::snprintf(buffer, capacity, "%s", message == nullptr ? "unknown encoder error" : message);
}

} // namespace

extern "C" int em_ktx2_encode_rgba8_stream(
    const uint8_t *pixels,
    size_t pixel_bytes,
    uint32_t width,
    uint32_t height,
    uint32_t row_stride_bytes,
    uint32_t flags,
    em_ktx2_write_callback write_chunk,
    void *user_data,
    char *error_message,
    size_t error_capacity) {
    if (error_message != nullptr && error_capacity > 0) error_message[0] = '\0';

    if (pixels == nullptr || write_chunk == nullptr || width == 0 || height == 0) {
        set_error(error_message, error_capacity, "invalid input or output callback");
        return 1;
    }
    if (width > kMaxDimension || height > kMaxDimension) {
        set_error(error_message, error_capacity, "image dimensions exceed Basis Universal's limit");
        return 1;
    }
    if ((flags & ~kKnownFlags) != 0 || ((flags & kSrgb) && (flags & kNormalMap))) {
        set_error(error_message, error_capacity, "unsupported or inconsistent image flags");
        return 1;
    }

    const size_t minimum_row_bytes = static_cast<size_t>(width) * 4;
    if (row_stride_bytes < minimum_row_bytes) {
        set_error(error_message, error_capacity, "row stride is smaller than one RGBA row");
        return 1;
    }
    const size_t required_bytes = static_cast<size_t>(height - 1) * row_stride_bytes + minimum_row_bytes;
    if (required_bytes > pixel_bytes || required_bytes > kMaxInputBytes) {
        set_error(error_message, error_capacity, "pixel buffer is truncated or exceeds the 256 MiB limit");
        return 1;
    }

    try {
        // Basis owns process-wide encoder state. Serialize calls and bound each
        // encode's worker pool so concurrent callers cannot multiply memory use.
        std::lock_guard<std::mutex> encodeLock(encodeMutex);
        std::call_once(encoderInitOnce, [] {
            encoderInitSucceeded = basisu::basisu_encoder_init(false, false);
        });
        if (!encoderInitSucceeded) {
            set_error(error_message, error_capacity, "Basis Universal initialization failed");
            return 2;
        }

        basisu::basis_compressor_params params;
        const auto hardwareThreads = std::thread::hardware_concurrency();
        const uint32_t threadCount = std::clamp(hardwareThreads == 0 ? 1u : hardwareThreads, 1u, kMaxEncoderThreads);
        basisu::job_pool jobPool(threadCount);
        params.m_pJob_pool = &jobPool;
        params.set_format_mode(basist::basis_tex_format::cUASTC_LDR_4x4);
        params.set_srgb_options((flags & kSrgb) != 0);
        params.m_mip_gen = (flags & kNoMipGeneration) == 0;
        params.m_mip_renormalize = (flags & kNormalMap) != 0;
        params.m_create_ktx2_file = true;
        params.m_write_output_basis_or_ktx2_files = false;
        params.m_read_source_images = false;
        params.m_status_output = false;
        params.m_print_stats = false;
        params.m_multithreading = threadCount > 1;

        params.m_source_images.resize(1);
        auto &image = params.m_source_images[0];
        image.crop(width, height, width, basisu::g_black_color, false);
        for (uint32_t y = 0; y < height; ++y) {
            std::memcpy(image.get_ptr() + static_cast<size_t>(y) * width,
                        pixels + static_cast<size_t>(y) * row_stride_bytes,
                        minimum_row_bytes);
        }

        basisu::basis_compressor compressor;
        if (!compressor.init(params)) {
            set_error(error_message, error_capacity, "Basis Universal rejected the image parameters");
            return 2;
        }
        if (compressor.process() != basisu::basis_compressor::cECSuccess) {
            set_error(error_message, error_capacity, "Basis Universal failed to encode UASTC KTX2");
            return 2;
        }

        const auto &encoded = compressor.get_output_ktx2_file();
        if (encoded.empty()) {
            set_error(error_message, error_capacity, "Basis Universal produced an empty KTX2 image");
            return 2;
        }
        constexpr size_t kOutputChunkBytes = 16u * 1024u;
        for (size_t offset = 0; offset < encoded.size(); offset += kOutputChunkBytes) {
            const auto chunk_bytes = std::min(kOutputChunkBytes, encoded.size() - offset);
            if (write_chunk(encoded.get_ptr() + offset, chunk_bytes, user_data) != 0) {
                set_error(error_message, error_capacity, "KTX2 output callback stopped the encode");
                return 3;
            }
        }
        return 0;
    } catch (const std::exception &exception) {
        set_error(error_message, error_capacity, exception.what());
        return 4;
    } catch (...) {
        set_error(error_message, error_capacity, "unexpected encoder failure");
        return 4;
    }
}

extern "C" const char *em_ktx2_version(void) {
    return "Basis Universal 2.50.0 UASTC KTX2";
}
