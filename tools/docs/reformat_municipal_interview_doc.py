"""지자체 인터뷰 대본 DOCX 를 인쇄용으로 다시 배치한다.

입력 DOCX 의 내용을 더 깔끔한 구조에 옮길 뿐, 문구·이름·질문·답변·체크 항목·비구속 조건은 바꾸지 않는다.
"""

from pathlib import Path
import re

from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


SOURCE = Path("/Users/derrick/Downloads/왜곡_지자체_인터뷰대본_사용의향서.docx")
OUTPUT = Path(
    "/Users/derrick/Documents/GitHub/kgeseo/프로젝트파일/인터뷰자료/"
    "왜곡_지자체_인터뷰대본_사용의향서_편집본.docx"
)

FONT = "AppleGothic"
NAVY = "1F3A5F"
BLACK = "000000"
MID_GRAY = "F2F4F7"
LIGHT_GRAY = "D9DEE7"
PALE_BLUE = "F7F9FC"
RED = "A63B2B"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, color=LIGHT_GRAY):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        element = borders.find(tag)
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "5")
        element.set(qn("w:color"), color)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_cant_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def set_column_width(cell, width_cm):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(width_cm * 567)))
    tc_w.set(qn("w:type"), "dxa")


def set_run(run, size=10.5, bold=False, color=BLACK, highlight=False):
    run.font.name = FONT
    rpr = run._element.get_or_add_rPr()
    fonts = rpr.rFonts
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.append(fonts)
    for key in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{key}"), FONT)
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)
    if highlight:
        run.font.highlight_color = WD_COLOR_INDEX.YELLOW


def add_highlighted_runs(paragraph, text, size=10.5, bold=False, color=BLACK):
    parts = re.split(r"(\[[^\]]+\])", text)
    for part in parts:
        if not part:
            continue
        run = paragraph.add_run(part)
        set_run(run, size=size, bold=bold, color=color, highlight=part.startswith("[") and part.endswith("]"))


def clear_paragraph(paragraph):
    p = paragraph._element
    for child in list(p):
        # 문단 속성(pPr)은 남겨야 Title 같은 이름 붙은 스타일이 유지된다.
        if child.tag != qn("w:pPr"):
            p.remove(child)


def setup_document():
    document = Document()
    section = document.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.65)
    section.bottom_margin = Cm(1.55)
    section.left_margin = Cm(1.7)
    section.right_margin = Cm(1.7)
    section.header_distance = Cm(0.7)
    section.footer_distance = Cm(0.75)

    styles = document.styles
    styles["Normal"].font.name = FONT
    styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    styles["Normal"].font.size = Pt(10.5)

    header = section.header
    header_p = header.paragraphs[0]
    header_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    header_p.paragraph_format.space_after = Pt(0)
    run = header_p.add_run("왜곡  지역 설화 기반 방탈출 서비스 인터뷰 자료")
    set_run(run, size=8.5, color="687385")

    footer = section.footer
    footer_p = footer.paragraphs[0]
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer_p.paragraph_format.space_before = Pt(0)
    run = footer_p.add_run("– ")
    set_run(run, size=8.5, color="687385")
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    footer_p._p.append(field)
    run = footer_p.add_run(" –")
    set_run(run, size=8.5, color="687385")
    return document


def add_paragraph(document, text="", size=10.5, before=0, after=6, line=1.25, bold=False, color=BLACK, align=None, keep=False):
    p = document.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    pf.keep_together = keep
    add_highlighted_runs(p, text, size=size, bold=bold, color=color)
    return p


def add_title(document, text, subtitle=None):
    p = document.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(72)
    p.paragraph_format.space_after = Pt(10)
    clear_paragraph(p)
    add_highlighted_runs(p, text, size=26, bold=True, color=BLACK)
    if subtitle:
        add_paragraph(document, subtitle, size=13, after=22, color="536273")


def add_heading(document, text, level=1, page_break=False):
    sizes = {1: 18, 2: 14, 3: 11.5}
    p = document.add_paragraph()
    p.paragraph_format.space_before = Pt(18 if level == 1 else 12)
    p.paragraph_format.space_after = Pt(7 if level == 1 else 4)
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.page_break_before = page_break
    add_highlighted_runs(p, text, size=sizes[level], bold=True, color=BLACK)
    return p


def add_bullet(document, text, size=10.5):
    p = document.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.45)
    p.paragraph_format.first_line_indent = Cm(-0.38)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.22
    p.paragraph_format.keep_together = True
    run = p.add_run("• ")
    set_run(run, size=size, bold=True, color=NAVY)
    add_highlighted_runs(p, text, size=size)
    return p


def add_note(document, text):
    # 비구속 안내 두 줄이 서명만 남은 빈 쪽으로 넘어가지 않게 양식과 붙여 둔다.
    p = add_paragraph(document, text, size=8.0, before=1, after=1, line=1.0, color="606C7A")
    p.paragraph_format.keep_together = True
    return p


def add_table(document, rows, widths=None, header=True, first_col_labels=False, size=9.6, blank_opinion=False):
    if not rows:
        return None
    cols = len(rows[0])
    table = document.add_table(rows=0, cols=cols)
    table.autofit = False
    table.alignment = WD_ALIGN_PARAGRAPH.CENTER
    table.style = "Table Grid"
    for r_idx, values in enumerate(rows):
        row = table.add_row()
        set_cant_split(row)
        if r_idx == 0 and header:
            set_repeat_table_header(row)
        for c_idx, value in enumerate(values):
            cell = row.cells[c_idx]
            if widths:
                set_column_width(cell, widths[c_idx])
            set_cell_margins(cell, top=86, start=105, bottom=86, end=105)
            set_cell_border(cell)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            if r_idx == 0 and header:
                set_cell_shading(cell, NAVY)
            elif first_col_labels and c_idx == 0:
                set_cell_shading(cell, MID_GRAY)
            elif r_idx % 2 == 0 and not blank_opinion:
                set_cell_shading(cell, PALE_BLUE)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.12
            clear_paragraph(p)
            if not value and blank_opinion:
                # 손글씨 칸은 작게 두어 선언문·안내가 양식과 한 장에 남게 한다.
                p.add_run(" ")
            else:
                add_highlighted_runs(
                    p,
                    value,
                    size=size,
                    bold=(r_idx == 0 and header) or (first_col_labels and c_idx == 0),
                    color="FFFFFF" if r_idx == 0 and header else BLACK,
                )
    document.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def extract_rows(source, table_index):
    return [[cell.text.strip() for cell in row.cells] for row in source.tables[table_index].rows]


def find_paragraph(source, starts):
    for paragraph in source.paragraphs:
        text = paragraph.text.strip()
        if text.startswith(starts):
            return text
    raise KeyError(starts)


def script_paragraphs(source, start, end):
    capture = False
    out = []
    for paragraph in source.paragraphs:
        text = paragraph.text.strip()
        if text == start:
            capture = True
        if capture:
            out.append(text)
        if capture and text == end:
            break
    return [text for text in out if text]


def add_interview_script(document, source, heading, table_index, end_heading, new_page=True):
    add_heading(document, heading, level=2, page_break=new_page)
    add_table(document, extract_rows(source, table_index), widths=[2.0, 15.6], header=False, first_col_labels=True, size=10)
    texts = script_paragraphs(source, heading, end_heading)
    for text in texts[1:]:
        if text.startswith("Q"):
            p = add_paragraph(document, text, size=10.3, before=5, after=1, line=1.1, bold=True, color=BLACK, keep=True)
            p.paragraph_format.keep_with_next = True
        elif text.startswith("답변"):
            body = text[2:].strip()
            p = document.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.45)
            p.paragraph_format.first_line_indent = Cm(-0.45)
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.line_spacing = 1.14
            tag = p.add_run("답변  ")
            set_run(tag, size=9.7, bold=True, color=RED)
            add_highlighted_runs(p, body, size=9.7)


def add_form(document, source, city, info_table, interest_table, opinion_table, signature_table, declaration, note1, note2):
    title = document.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.page_break_before = True
    title.paragraph_format.space_before = Pt(0)
    title.paragraph_format.space_after = Pt(2)
    add_highlighted_runs(title, "서비스 사용 의향서", size=20, bold=True)
    city_p = add_paragraph(document, f"{city}", size=12, after=3, color="536273", align=WD_ALIGN_PARAGRAPH.CENTER)
    city_p.paragraph_format.keep_with_next = True

    add_table(document, extract_rows(source, info_table), widths=[2.35, 15.25], header=False, first_col_labels=True, size=9.6)
    form_heading_1 = add_heading(document, "1. 사용 및 협력 검토 의향", level=3)
    form_heading_1.paragraph_format.space_before = Pt(8)
    form_heading_1.paragraph_format.space_after = Pt(2)
    # 체크 항목 문구는 그대로 두고 체크하기 쉬운 목록으로 그린다.
    checklist = [p.text.strip() for p in source.paragraphs if p.text.strip().startswith("☐  지역 설화") or p.text.strip().startswith("☐  현장") or p.text.strip().startswith("☐  관리자") or p.text.strip().startswith("☐  보상") or p.text.strip().startswith("☐  성과")]
    # 입력 문서에 목록이 두 번 나오므로 도시에 맞는 여섯 줄을 고른다.
    if city == "나주시":
        checklist = checklist[:6]
    else:
        checklist = checklist[6:12]
    for item in checklist:
        item_p = add_bullet(document, item, size=9.4)
        item_p.paragraph_format.space_after = Pt(2)

    form_heading_2 = add_heading(document, "2. 관심 기능", level=3)
    form_heading_2.paragraph_format.space_before = Pt(8)
    form_heading_2.paragraph_format.space_after = Pt(2)
    add_table(document, extract_rows(source, interest_table), widths=[8.8, 8.8], header=False, first_col_labels=False, size=9.3)
    form_heading_3 = add_heading(document, "3. 의견", level=3)
    form_heading_3.paragraph_format.space_before = Pt(8)
    form_heading_3.paragraph_format.space_after = Pt(2)
    add_table(document, extract_rows(source, opinion_table), widths=[17.6], header=False, size=9.3, blank_opinion=True)

    p = add_paragraph(document, declaration, size=8.9, before=3, after=3, line=1.13)
    p.paragraph_format.keep_together = True
    add_table(document, extract_rows(source, signature_table), widths=[3.9, 13.7], header=False, first_col_labels=True, size=9.2)
    add_note(document, note1)
    add_note(document, note2)


def main():
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    source = Document(SOURCE)
    document = setup_document()

    # 표지
    add_title(document, source.paragraphs[1].text.strip(), source.paragraphs[2].text.strip())
    add_paragraph(document, source.paragraphs[5].text.strip(), size=15, after=6, line=1.25, bold=True)
    add_paragraph(document, source.paragraphs[6].text.strip(), size=12, after=30, line=1.25, color="536273")
    add_table(document, extract_rows(source, 0), widths=[2.4, 15.2], header=False, first_col_labels=True, size=10.2)

    # 촬영 안내
    add_heading(document, find_paragraph(source, "1. 촬영 요청 안내"), level=1, page_break=True)
    add_paragraph(document, find_paragraph(source, "바쁘신 가운데"), size=10.8, after=10)
    add_table(document, extract_rows(source, 1), widths=[3.25, 14.35], header=False, first_col_labels=True, size=9.7)
    add_heading(document, find_paragraph(source, "대본 사용 방법"), level=2)
    for prefix in ("말씀하시기", "노란 음영", "답변은 기관", "대본에 나오는"):
        add_bullet(document, find_paragraph(source, prefix), size=10.1)
    add_table(document, extract_rows(source, 2), widths=[17.6], header=False, size=10, blank_opinion=False)

    # 서비스 소개
    add_heading(document, find_paragraph(source, "2. 서비스 소개"), level=1, page_break=True)
    add_table(document, extract_rows(source, 3), widths=[17.6], header=False, size=11)
    add_heading(document, find_paragraph(source, "2-1. 우리가"), level=2)
    add_table(document, extract_rows(source, 4), widths=[3.25, 7.75, 6.6], header=True, size=9.2)
    add_heading(document, find_paragraph(source, "2-2. 페르소나"), level=2)
    add_table(document, extract_rows(source, 5), widths=[2.1, 4.45, 11.05], header=True, size=8.6)
    add_heading(document, find_paragraph(source, "2-3. 기획"), level=2)
    for prefix in ("정보가 아니라", "두 개의 완결", "보상은 방문", "한 편이 아니라"):
        add_bullet(document, find_paragraph(source, prefix), size=10.2)

    # 확장: 제목이 소개하는 절차 표와 같은 쪽에 붙게 한다.
    add_heading(document, find_paragraph(source, "2-4. 확장"), level=2)
    add_heading(document, find_paragraph(source, "① 최소한의"), level=3)
    add_table(document, extract_rows(source, 6), widths=[4.4, 4.4, 4.4, 4.4], header=True, size=8.6)
    add_note(document, find_paragraph(source, "※ 가장 어려운"))
    add_heading(document, find_paragraph(source, "② 방문 인증"), level=3)
    for prefix in ("현장 인증", "보상 조건", "예산 관리"):
        add_bullet(document, find_paragraph(source, prefix), size=9.9)
    add_heading(document, find_paragraph(source, "③ 관리자"), level=3, page_break=True)
    add_table(document, extract_rows(source, 7), widths=[4.8, 12.8], header=True, size=9.25)
    add_heading(document, find_paragraph(source, "④ 운영과"), level=3)
    for prefix in ("템플릿 게시", "운영 부담", "광역 연계", "경험 확장"):
        add_bullet(document, find_paragraph(source, prefix), size=9.9)

    # 인터뷰 대본 — 대본마다 새 쪽에서 시작해 제목만 홀로 남지 않게 한다.
    add_heading(document, find_paragraph(source, "3. 인터뷰 대본"), level=1, page_break=True)
    add_interview_script(document, source, find_paragraph(source, "대본 A"), 8, find_paragraph(source, "대본 B"), new_page=False)
    add_interview_script(document, source, find_paragraph(source, "대본 B"), 9, find_paragraph(source, "대본 C"))
    add_interview_script(document, source, find_paragraph(source, "대본 C"), 10, find_paragraph(source, "대본 D"))
    add_interview_script(document, source, find_paragraph(source, "대본 D"), 11, find_paragraph(source, "서비스 사용 의향서"))

    # 비구속 사용 의향서 — 도시마다 따로 쓸 수 있는 구역 하나씩.
    add_form(
        document,
        source,
        "나주시",
        12,
        13,
        14,
        15,
        find_paragraph(source, "본 기관(부서)은 위 서비스"),
        find_paragraph(source, "※ 본 의향서는"),
        find_paragraph(source, "※ 광주인공지능사관학교"),
    )
    # 두 번째 도시의 선언문·안내는 입력 문서에 있는 두 번째 사본을 그대로 쓴다.
    occurrences = [p.text.strip() for p in source.paragraphs if p.text.strip().startswith("본 기관(부서)은 위 서비스")]
    notes1 = [p.text.strip() for p in source.paragraphs if p.text.strip().startswith("※ 본 의향서는")]
    notes2 = [p.text.strip() for p in source.paragraphs if p.text.strip().startswith("※ 광주인공지능사관학교")]
    add_form(document, source, "목포시", 16, 17, 18, 19, occurrences[1], notes1[1], notes2[1])

    document.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
