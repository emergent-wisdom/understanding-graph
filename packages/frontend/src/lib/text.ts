const NAMED_TEXT_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
}

/**
 * Decode the small HTML-entity vocabulary that can appear in API prose.
 *
 * This deliberately returns plain text rather than parsing HTML. React will
 * escape the result when it renders the string, so encoded markup remains
 * inert while punctuation such as `&apos;` displays normally.
 */
export function decodeTextEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (match, encoded: string) => {
      if (!encoded.startsWith('#')) {
        return NAMED_TEXT_ENTITIES[encoded.toLowerCase()] ?? match
      }

      const isHex = encoded[1]?.toLowerCase() === 'x'
      const digits = encoded.slice(isHex ? 2 : 1)
      const codePoint = Number.parseInt(digits, isHex ? 16 : 10)

      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return match
      }

      return String.fromCodePoint(codePoint)
    },
  )
}
