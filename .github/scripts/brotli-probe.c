#include <brotli/decode.h>
#include <brotli/encode.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  const unsigned char input[] = "GitThul Brotli package verification";
  unsigned char compressed[256], output[256];
  size_t compressed_size = sizeof(compressed), output_size = sizeof(output);
  unsigned version = BrotliDecoderVersion();
  if (version != BrotliEncoderVersion()) return 1;
  if (!BrotliEncoderCompress(5, BROTLI_DEFAULT_WINDOW, BROTLI_MODE_GENERIC,
                            sizeof(input), input, &compressed_size, compressed))
    return 2;
  if (BrotliDecoderDecompress(compressed_size, compressed, &output_size, output) !=
      BROTLI_DECODER_RESULT_SUCCESS)
    return 3;
  if (output_size != sizeof(input) || memcmp(input, output, sizeof(input))) return 4;
  printf("%u.%u.%u\n", version >> 24, (version >> 12) & 4095, version & 4095);
  return 0;
}
