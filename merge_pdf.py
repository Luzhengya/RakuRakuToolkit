import sys
import os

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Error: PyMuPDF not found. Install with: pip install PyMuPDF", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python merge_pdf.py <output.pdf> <input1.pdf> <input2.pdf> ...", file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]
    input_paths = sys.argv[2:]

    try:
        merged = fitz.open()
        for input_path in input_paths:
            if not os.path.exists(input_path):
                print(f"Error: File not found: {input_path}", file=sys.stderr)
                sys.exit(1)
            doc = fitz.open(input_path)
            merged.insert_pdf(doc)
            doc.close()

        out_dir = os.path.dirname(output_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        # garbage=4 removes unused objects; deflate=True compresses streams
        merged.save(output_path, garbage=4, deflate=True)
        merged.close()
        print(f"Success: merged {len(input_paths)} files into {output_path}")
        sys.exit(0)
    except Exception as e:
        print(f"Error during merge: {e}", file=sys.stderr)
        sys.exit(1)
