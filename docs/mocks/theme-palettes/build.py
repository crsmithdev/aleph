# Builds index.html: each theme's colours mapped onto aleph's ten palette tokens, drawn as a small aleph page.
# Token order: bg, surface, sunk, raised, ink, ink-2, muted, rule, rule-2, focus. None: the theme has no such variant.
import html, pathlib

T = [
 ("Lavender (today)", "aleph's own",
  ("#F4F3FA","#FFFFFF","#ECEAF6","#ECEAF6","#292D3E","#4A4F6A","#62688A","#DCD9EC","#E8E6F3","#7E57C2"),
  ("#202331","#292D3E","#191C28","#32374D","#EEF1F8","#BFC7D5","#9AA2C6","#3A3F58","#2E3245","#C792EA")),
 ("Dracula", "Alucard for light",
  ("#F5F1DE","#FFFBEB","#ECE8D2","#E5E1C9","#1F1F1F","#3D3D3D","#6C664B","#DEDAC2","#ECE8D2","#644AC9"),
  ("#21222C","#282A36","#191A21","#44475A","#F8F8F2","#E2E2DC","#8E9AC6","#44475A","#343746","#BD93F9")),
 ("Nord", "Snow Storm for light",
  ("#E5E9F0","#ECEFF4","#D8DEE9","#D8DEE9","#2E3440","#3B4252","#4C566A","#D0D7E2","#E0E5ED","#5E81AC"),
  ("#2E3440","#3B4252","#272C36","#434C5E","#ECEFF4","#D8DEE9","#9AA4B8","#4C566A","#434C5E","#88C0D0")),
 ("Solarized", "",
  ("#EEE8D5","#FDF6E3","#E6DFCB","#E6DFCB","#586E75","#657B83","#7C8C8C","#DDD6C1","#EAE4D1","#268BD2"),
  ("#00212B","#002B36","#001A22","#073642","#93A1A1","#839496","#6F8A90","#0A4050","#073642","#268BD2")),
 ("Gruvbox", "soft light, medium dark",
  ("#F2E5BC","#FBF1C7","#EBDBB2","#EBDBB2","#3C3836","#504945","#7C6F64","#D5C4A1","#EBDBB2","#AF3A03"),
  ("#1D2021","#282828","#171A1A","#3C3836","#EBDBB2","#D5C4A1","#A89984","#504945","#32302F","#FE8019")),
 ("One", "One Light and One Dark",
  ("#EAEAEB","#FAFAFA","#E5E5E6","#E0E0E2","#383A42","#4F525D","#696C77","#DBDBDC","#E5E5E6","#4078F2"),
  ("#21252B","#282C34","#1B1E23","#2C313A","#D7DAE0","#ABB2BF","#8B919C","#3E4451","#2C313A","#61AFEF")),
 ("Monokai", "dark only",
  None,
  ("#1E1F1C","#272822","#171814","#3E3D32","#F8F8F2","#CFCFC2","#A09E8A","#3E3D32","#34352D","#A6E22E")),
 ("Tokyo Night", "Day for light",
  ("#D0D5E3","#E1E2E7","#C4C8DA","#C4C8DA","#343B58","#3760BF","#6172B0","#B4BAD3","#C4C8DA","#2E7DE9")),
 ("Catppuccin", "Latte and Mocha",
  ("#E6E9EF","#EFF1F5","#DCE0E8","#CCD0DA","#4C4F69","#5C5F77","#6C6F85","#BCC0CC","#CCD0DA","#8839EF"),
  ("#181825","#1E1E2E","#11111B","#313244","#CDD6F4","#BAC2DE","#A6ADC8","#45475A","#313244","#CBA6F7")),
 ("Rosé Pine", "Dawn and Main",
  ("#F2E9E1","#FFFAF3","#F4EDE8","#F2E9E1","#575279","#797593","#7F7A92","#DFDAD9","#F4EDE8","#907AA9"),
  ("#191724","#1F1D2E","#16141F","#26233A","#E0DEF4","#C9C6E0","#908CAA","#403D52","#26233A","#C4A7E7")),
 ("Everforest", "medium",
  ("#F4F0D9","#FFFBEF","#EFEBD4","#E6E2CC","#5C6A72","#6B7A80","#829181","#E0DCC7","#EFEBD4","#8DA101"),
  ("#232A2E","#2D353B","#1E2326","#3D484D","#D3C6AA","#C5B99E","#9DA9A0","#475258","#343F44","#A7C080")),
 ("Kanagawa", "Lotus and Wave",
  ("#E5DDB0","#F2ECBC","#E7DBA0","#DCD5AC","#545464","#43436C","#77766E","#D5CEA3","#E5DDB0","#4D699B"),
  ("#16161D","#1F1F28","#13131A","#2A2A37","#DCD7BA","#C8C093","#938E7E","#363646","#2A2A37","#7E9CD8")),
 ("Ayu", "Light and Dark",
  ("#F3F4F5","#FCFCFC","#E7EAED","#E7EAED","#5C6166","#6B7075","#828A93","#E1E4E8","#EDEFF1","#FA8D3E"),
  ("#07090D","#0D1017","#05070A","#131721","#BFBDB6","#ACB6BF","#7A808B","#1F2430","#131721","#E6B450")),
 ("GitHub", "",
  ("#F6F8FA","#FFFFFF","#EAEEF2","#EAEEF2","#1F2328","#424A53","#656D76","#D0D7DE","#EAEEF2","#0969DA"),
  ("#0D1117","#161B22","#010409","#21262D","#E6EDF3","#C9D1D9","#8D96A0","#30363D","#21262D","#2F81F7")),
 ("Night Owl", "Light Owl for light",
  ("#F0F0F0","#FBFBFB","#E5E9EC","#E0E7EA","#403F53","#4E4D63","#6B7486","#D9D9D9","#ECECEC","#4876D6"),
  ("#010E1A","#011627","#000A12","#0B2942","#D6DEEB","#C5D4E4","#8BA0B4","#1D3B53","#0B2942","#82AAFF")),
 ("Cobalt2", "dark only",
  None,
  ("#15232D","#193549","#0D1A22","#1F4662","#FFFFFF","#E1EFFF","#9DB3CA","#234E6D","#1F4662","#FFC600")),
 ("Tomorrow", "Tomorrow and Tomorrow Night",
  ("#EFEFEF","#FFFFFF","#E5E5E5","#D6D6D6","#4D4D4C","#5A5A59","#767876","#D6D6D6","#EAEAEA","#4271AE"),
  ("#1D1F21","#282A2E","#161719","#373B41","#C5C8C6","#B4B7B4","#969896","#373B41","#2E3034","#81A2BE")),
 ("Zenburn", "dark only",
  None,
  ("#313131","#3F3F3F","#2B2B2B","#4F4F4F","#DCDCCC","#C3C3B0","#A0A08F","#5F5F5F","#4A4A4A","#8CD0D3")),
 ("Horizon", "Bright and Dark",
  ("#FADAD1","#FDF0ED","#F9CBBE","#F9CBBE","#1C1E26","#2E303E","#5E6177","#F4C2B4","#F9D4CA","#DA103F"),
  ("#16161C","#1C1E26","#121216","#2E303E","#D5D8DA","#CBCED0","#8A8DAE","#2E303E","#232530","#E95678")),
 ("Synthwave '84", "dark only",
  None,
  ("#1E1A2B","#262335","#171520","#34294F","#FFFFFF","#E0DCEB","#9097C8","#34294F","#2A2139","#FF7EDB")),
 ("Nightfox", "Dawnfox for light",
  ("#EBE5DF","#FAF4ED","#EBDFE4","#EBDFE4","#575279","#625C87","#7A7598","#D0C7D4","#EBE5DF","#286983"),
  ("#131A24","#192330","#0D131B","#29394F","#CDCECF","#AEAFB0","#8494AB","#39506D","#212E3F","#719CD6")),
 ("Poimandres", "dark only",
  None,
  ("#171922","#1B1E28","#13151D","#303340","#E4F0FB","#A6ACCD","#8288A8","#303340","#252B37","#5DE4C7")),
 ("Vitesse", "",
  ("#F7F7F7","#FFFFFF","#EEEEEE","#EEEEEE","#393A34","#4E4F47","#6E776E","#E7E7E7","#F0F0F0","#1C6B48"),
  ("#0B0B0B","#121212","#080808","#222222","#DBD7CA","#BFBAAA","#8A958A","#2B2B2B","#191919","#4D9375")),
 ("Flexoki", "",
  ("#F2F0E5","#FFFCF0","#E6E4D9","#E6E4D9","#100F0F","#403E3C","#6F6E69","#DAD8CE","#E6E4D9","#205EA6"),
  ("#100F0F","#1C1B1A","#0B0A0A","#282726","#CECDC3","#B7B5AC","#878580","#343331","#282726","#4385BE")),
 ("Iceberg", "",
  ("#DCDFE7","#E8E9EC","#CAD0DE","#CAD0DE","#33374C","#444B71","#6F758F","#C6C8D1","#DCDFE7","#2D539E"),
  ("#0F1117","#161821","#0B0C11","#1E2132","#C6C8D1","#B3B6C2","#7F849D","#2E3244","#1E2132","#84A0C6")),
 ("Oceanic Next", "dark only",
  None,
  ("#16232A","#1B2B34","#121D23","#343D46","#D8DEE9","#C0C5CE","#A7ADBA","#343D46","#22343E","#6699CC")),
 ("PaperColor", "",
  ("#E4E4E4","#EEEEEE","#DADADA","#D0D0D0","#444444","#4E4E4E","#6C6C6C","#D0D0D0","#E4E4E4","#005F87"),
  ("#121212","#1C1C1C","#0E0E0E","#303030","#D0D0D0","#BCBCBC","#8A8A8A","#3A3A3A","#262626","#5FAFD7")),
]
# Tokyo Night's dark map, kept apart above so the light tuple reads first.
T[7] = T[7] + (("#16161E","#1A1B26","#13131A","#24283B","#C0CAF5","#A9B1D6","#7F86AA","#292E42","#1F2335","#7AA2F7"),)

# Status colours stay in every palette (docs/design.md, Palettes); these are aleph's own.
STATUS = {"light": ("#C0304C", "#437018", "#8A5A00"), "dark": ("#F07178", "#A9C77D", "#FFCB6B")}
KEYS = ("bg", "surface", "sunk", "raised", "ink", "ink2", "muted", "rule", "rule2", "focus")

def page(c, mode):
  if c is None:
    return f'<div class="pv none">no {mode} variant</div>'
  v = dict(zip(KEYS, c)); fail, ok, warn = STATUS[mode]
  return (f'<div class="pv" style="background:{v["bg"]};color:{v["ink"]};border-color:{v["rule"]}">'
    f'<div class="side" style="border-color:{v["rule"]}"><b>aleph</b><span class="nav on" style="background:{v["raised"]}">Status</span>'
    f'<span class="nav" style="color:{v["ink2"]}">Issues</span><span class="nav" style="color:{v["ink2"]}">Jobs</span></div>'
    f'<div class="main"><div class="card" style="background:{v["surface"]};border-color:{v["rule2"]}">'
    f'<div class="ct">Landed</div><div class="big">66%</div><div style="color:{v["muted"]}">clean / landed</div></div>'
    f'<div class="card" style="background:{v["surface"]};border-color:{v["rule2"]}">'
    f'<div class="row" style="border-color:{v["rule"]}"><span class="chip" style="color:{ok};background:{v["sunk"]}">landed</span><span style="color:{v["ink2"]}">a3347 Stop links</span></div>'
    f'<div class="row" style="border-color:{v["rule"]}"><span class="chip" style="color:{fail};background:{v["sunk"]}">failed</span><span style="color:{v["ink2"]}">a3342 Test pages</span></div>'
    f'<div class="row"><span class="chip" style="color:{warn};background:{v["sunk"]}">needs you</span><a style="color:{v["focus"]}">a3348</a></div>'
    f'<button style="background:{v["focus"]};color:{v["surface"]}">Pause</button></div></div></div>')

cards = []
for i, (name, note, light, dark) in enumerate(T, 1):
  dots = "".join(f'<i style="background:{x}"></i>' for x in ((dark or light)[1], (dark or light)[4], (dark or light)[9], (light or dark)[1]))
  cards.append(f'<section class="theme" id="t{i}" data-annotate="theme/{i}"><h2><span class="n">{i}</span> {html.escape(name)}'
    f'<span class="dots">{dots}</span></h2><p class="note">{html.escape(note)}</p>'
    f'<div class="pair"><figure>{page(light, "light")}<figcaption>Light</figcaption></figure>'
    f'<figure>{page(dark, "dark")}<figcaption>Dark</figcaption></figure></div></section>')

head = pathlib.Path(__file__).with_name("head.html").read_text()
pathlib.Path(__file__).with_name("index.html").write_text(head + "\n".join(cards) + "\n</main></body></html>\n")
print(len(T), "themes")
