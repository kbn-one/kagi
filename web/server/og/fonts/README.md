# og/fonts

What the social cards are drawn with. Every `.ttf` or `.otf` here is registered
with Skia, in file-name order, and Skia falls back through them per glyph — so
the order is the fallback order, and adding a script is dropping a file in.

Nothing here is served to a browser. These files exist because Skia needs real
font data: there is no system font stack to fall back on and no CSS to resolve
one.

| File                     | Covers                               | Licence                                                        |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------- |
| `Inter-Regular.ttf`      | Latin, and most of the rest          | [`LICENSE-Inter.txt`](./LICENSE-Inter.txt) (SIL OFL)           |
| `Inter-Bold.ttf`         | the same, bold                       | as above                                                       |
| `NotoSansJP-Regular.ttf` | Japanese — kana and JIS X 0208 kanji | [`LICENSE-NotoSansJP.txt`](./LICENSE-NotoSansJP.txt) (SIL OFL) |

Inter sorts first, so Latin is Inter's even though Noto Sans JP has Latin of its
own.

## Why Japanese has one weight and Latin has two

Skia synthesises a bold face for a family that has none, so a bold title is bold
in both scripts from these three files. Inter ships real weights because they
are 400KB each and a drawn bold beats a synthesised one; Noto Sans JP does not,
because a second CJK face is another 2MB for a difference nobody would pick out
of a lineup at this size.

## The Japanese subset

`NotoSansJP-Regular.ttf` is not the upstream file. It is
[Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) 2.004 (`v56`
on `fonts.gstatic.com`) cut down to **JIS X 0208** — every kana, every symbol
and all 6,355 kanji of levels 1 and 2. That is 6,878 characters and 2.2MB,
against 16,732 characters and 5.3MB for the whole font.

A character outside that set — `鷗`, `𠮟`, anything in JIS X 0213 but not 0208,
and every script neither font covers — is drawn as this font's `.notdef`, which
is blank. A name quietly loses a letter, on an image nobody looks at. So the
build says so:

```
og: no glyph for 鷗 in /blog/mori-ogai — see server/og/fonts/README.md
```

It is a warning rather than an error because one missing character is not a
reason to fail a deploy. To make it go away, replace this file with the full
Noto Sans JP, or with any other font that has the character: the directory is
the only place the fonts are named.

### Regenerating it

The character set is JIS X 0208 recovered from the EUC-JP codec, so there is no
list to keep anywhere:

```sh
# The upstream font, as Google Fonts serves it.
curl -sS -H 'User-Agent: curl' \
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400' |
  grep -o 'https://[^)]*\.ttf' |
  xargs curl -sSL -o NotoSansJP-upstream.ttf

# Every character JIS X 0208 can encode.
python3 -c '
codes = set()
for hi in range(0xA1, 0xFF):
    for lo in range(0xA1, 0xFF):
        try:
            codes.add(bytes([hi, lo]).decode("euc_jp"))
        except UnicodeDecodeError:
            pass
print("".join(sorted(codes)), end="")
' > jis0208.txt

# pip install fonttools
python3 -m fontTools.subset NotoSansJP-upstream.ttf \
  --text-file=jis0208.txt \
  --layout-features='*' \
  --output-file=NotoSansJP-Regular.ttf
```

The family name stays `Noto Sans JP`. The OFL requires a rename only for a
Reserved Font Name, and this font's is `Source` — inherited from Source Han
Sans, which Noto Sans CJK is built from.
