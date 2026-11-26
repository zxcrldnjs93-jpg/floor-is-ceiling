import argparse
import ctypes as c
import os
import unicodedata
from contextlib import ExitStack
from pathlib import Path


def symbol(library, name, result, *arguments):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = arguments
    return function


def subset(font, index, codepoints):
    hb = c.CDLL("libharfbuzz.so.0")
    hb_subset = c.CDLL("libharfbuzz-subset.so.0")
    pointer, unsigned = c.c_void_p, c.c_uint
    blob_from_file = symbol(hb, "hb_blob_create_from_file_or_fail", pointer, c.c_char_p)
    blob_destroy = symbol(hb, "hb_blob_destroy", None, pointer)
    make_face = symbol(hb, "hb_face_create", pointer, pointer, unsigned)
    face_destroy = symbol(hb, "hb_face_destroy", None, pointer)
    count_faces = symbol(hb, "hb_face_count", unsigned, pointer)
    make_input = symbol(hb_subset, "hb_subset_input_create_or_fail", pointer)
    input_destroy = symbol(hb_subset, "hb_subset_input_destroy", None, pointer)
    input_unicodes = symbol(hb_subset, "hb_subset_input_unicode_set", pointer, pointer)
    set_add = symbol(hb, "hb_set_add", None, pointer, unsigned)
    make_subset = symbol(hb_subset, "hb_subset_or_fail", pointer, pointer, pointer)
    face_blob = symbol(hb, "hb_face_reference_blob", pointer, pointer)
    blob_data = symbol(hb, "hb_blob_get_data", pointer, pointer, c.POINTER(unsigned))

    with ExitStack() as stack:
        def keep(handle, destroy):
            if not handle:
                raise ValueError("HarfBuzz가 글꼴 데이터를 열거나 변환하지 못했습니다.")
            stack.callback(destroy, handle)
            return handle

        blob = keep(blob_from_file(os.fsencode(font)), blob_destroy)
        if not 0 <= index < count_faces(blob):
            raise ValueError("글꼴 컬렉션에 지정한 face index가 없습니다.")
        face = keep(make_face(blob, index), face_destroy)
        settings = keep(make_input(), input_destroy)
        unicode_set = input_unicodes(settings)
        for codepoint in codepoints:
            set_add(unicode_set, codepoint)
        result = keep(make_subset(face, settings), face_destroy)
        encoded = keep(face_blob(result), blob_destroy)
        size = unsigned()
        data = blob_data(encoded, c.byref(size))
        if not data or not size.value:
            raise ValueError("서브셋 결과가 비어 있습니다.")
        return c.string_at(data, size.value)


def main():
    parser = argparse.ArgumentParser(description="로컬 HarfBuzz로 글꼴을 서브셋합니다.")
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--font-index", type=int, default=0)
    parser.add_argument("--text-file", type=Path, required=True, help="UTF-8 화면 문구 모음")
    parser.add_argument("--output", type=Path, required=True, help="서브셋 OTF 또는 TTF")
    args = parser.parse_args()
    try:
        text = unicodedata.normalize("NFC", args.text_file.read_text(encoding="utf-8"))
        codepoints = {ord(char) for char in text if not unicodedata.category(char).startswith("C")}
        codepoints.update(range(32, 127))
        data = subset(args.font, args.font_index, codepoints)
        extension = ".otf" if data.startswith(b"OTTO") else ".ttf"
        if args.output.suffix.lower() != extension:
            raise ValueError(f"출력 파일 이름은 {extension}로 끝나야 합니다.")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(data)
    except (AttributeError, OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(f"글꼴 서브셋 생성 ({args.output}, {len(data):,}바이트, 요청 문자 {len(codepoints)})")


if __name__ == "__main__":
    main()
