# HTML Entity & Character Reference

Read this file when looking up correct HTML entities or auditing existing HTML for incorrect character usage.

---

## Quick Substitution Table

| If you see | Replace with | Entity | Rule |
|------------|-------------|--------|------|
| "straight double" | "curly double" | `&ldquo;` `&rdquo;` | Always curly quotes |
| 'straight single' | 'curly single' | `&lsquo;` `&rsquo;` | Always curly quotes |
| it's (straight) | it's (curly) | `&rsquo;` | Apostrophe = closing single quote |
| -- | -- | `&ndash;` | En dash for ranges |
| --- | --- | `&mdash;` | Em dash for breaks |
| ... | ... | `&hellip;` | Single ellipsis character |
| (c) | (c) | `&copy;` | Real copyright symbol |
| (TM) | TM | `&trade;` | Real trademark symbol |
| (R) | (R) | `&reg;` | Real registered symbol |
| 12 x 34 | 12 x 34 | `&times;` | Real multiplication sign |
| 56 - 12 (math) | 56 - 12 | `&minus;` | Real minus sign |
| 6' 10" (curly) | 6' 10" (straight) | `&#39;` `&quot;` | Foot/inch must be straight |

---

## Complete Entity Table

### Quotes and Apostrophes

```
&ldquo;   U+201C   opening double quote
&rdquo;   U+201D   closing double quote
&lsquo;   U+2018   opening single quote
&rsquo;   U+2019   closing single quote / apostrophe
&quot;    U+0022   straight double quote (inch mark only)
&#39;     U+0027   straight single quote (foot mark only)
```

### Dashes

```
-              U+002D   hyphen (compound words, line breaks)
&ndash;   U+2013   en dash (ranges: 1-10, connections)
&mdash;   U+2014   em dash (sentence breaks)
&shy;          U+00AD   soft/optional hyphen
```

### Symbols

```
&hellip;  U+2026   ellipsis
&times;   U+00D7   multiplication sign
&minus;   U+2212   minus sign
&divide;  U+00F7   division sign
&plusmn;  U+00B1   plus-minus sign
&copy;    U+00A9   copyright
&trade;   U+2122   trademark
&reg;     U+00AE   registered trademark
&para;    U+00B6   paragraph mark
&sect;    U+00A7   section mark
&amp;     U+0026   ampersand
&deg;     U+00B0   degree sign
```

### Spaces

```
&nbsp;         U+00A0   nonbreaking space
&thinsp;       U+2009   thin space
&ensp;         U+2002   en space
&emsp;         U+2003   em space
&hairsp;       U+200A   hair space
```

### Primes (Foot/Inch/Minute/Second)

```
&#39;     U+0027   foot mark / minute mark (straight single)
&quot;    U+0022   inch mark / second mark (straight double)
&prime;   U+2032   true prime (if font supports)
&Prime;   U+2033   true double prime (if font supports)
```

### Arrows and Misc

```
&larr;    U+2190   left arrow
&rarr;    U+2192   right arrow
&uarr;    U+2191   up arrow
&darr;    U+2193   down arrow
&bull;    U+2022   bullet
&middot;  U+00B7   middle dot
&laquo;   U+00AB   left guillemet
&raquo;   U+00BB   right guillemet
```

---

## Common Accented Characters

Always preserve accents in proper names.

```
&eacute;  e       &Eacute;  E
&egrave;  e       &Egrave;  E
&aacute;  a       &Aacute;  A
&agrave;  a       &Agrave;  A
&iacute;  i       &Iacute;  I
&oacute;  o       &Oacute;  O
&uacute;  u       &Uacute;  U
&uuml;    u       &Uuml;    U
&ouml;    o       &Ouml;    O
&ccedil;  c       &Ccedil;  C
&ntilde;  n       &Ntilde;  N
```

---

## Usage Patterns

### Quoted Text
```html
<p>&ldquo;She said &lsquo;hello&rsquo; to me,&rdquo; he reported.</p>
```

### Decade Abbreviations
```html
<p>In the &rsquo;70s, rock &rsquo;n&rsquo; roll dominated.</p>
```

### Ranges and Connections
```html
<p>Pages 4&ndash;8</p>
<p>The 2020&ndash;2025 period</p>
```

### Sentence Breaks
```html
<p>The em dash puts a nice pause in text&mdash;and is underused.</p>
```

### Legal/Academic References
```html
<p>Under &sect;&nbsp;1782, the seller may offer a refund.</p>
```

### Copyright and Trademark
```html
<footer>&copy;&nbsp;2025 MegaCorp&trade;</footer>
```

### Measurements
```html
<p>The room is 12&#39;&nbsp;6&quot; &times; 8&#39;&nbsp;10&quot;.</p>
```

### Math
```html
<p>12 &times; 34 &minus; 56 = 352</p>
```
