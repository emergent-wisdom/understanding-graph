import { describe, expect, it } from 'vitest'
import { decodeTextEntities } from './text'

describe('decodeTextEntities', () => {
  it('decodes named punctuation without parsing HTML', () => {
    expect(
      decodeTextEntities(
        'The &apos;graph&apos; says &quot;A &amp; B&quot; and &lt;script&gt;.',
      ),
    ).toBe(`The 'graph' says "A & B" and <script>.`)
  })

  it('decodes decimal and hexadecimal code points', () => {
    expect(decodeTextEntities('Arrow: &#8594; / &#x2192;')).toBe('Arrow: → / →')
  })

  it('preserves unknown and invalid entities', () => {
    expect(decodeTextEntities('&copy; &#x110000; &#xD800; &not-finished')).toBe(
      '&copy; &#x110000; &#xD800; &not-finished',
    )
  })
})
