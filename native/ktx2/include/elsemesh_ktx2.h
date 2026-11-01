#ifndef ELSEMESH_KTX2_H
#define ELSEMESH_KTX2_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define ELSEMESH_KTX2_API __declspec(dllexport)
#else
#define ELSEMESH_KTX2_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

// Encodes one tightly packed or row-strided RGBA8 image to UASTC KTX2 and
// writes the result to the caller in bounded chunks. Return non-zero from the
// callback to stop the encode. No output-file staging or caller-owned output
// allocation is required.
// Each chunk pointer is valid only for the duration of that callback.
// flags: bit 0 = sRGB transfer; bit 1 = renormalize generated normal-map mips.
typedef int (*em_ktx2_write_callback)(const uint8_t *chunk, size_t chunk_bytes, void *user_data);

ELSEMESH_KTX2_API int em_ktx2_encode_rgba8_stream(
    const uint8_t *pixels,
    size_t pixel_bytes,
    uint32_t width,
    uint32_t height,
    uint32_t row_stride_bytes,
    uint32_t flags,
    em_ktx2_write_callback write_chunk,
    void *user_data,
    char *error_message,
    size_t error_capacity);

ELSEMESH_KTX2_API const char *em_ktx2_version(void);

#ifdef __cplusplus
}
#endif

#endif
