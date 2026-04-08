import sys
import os

try:
    from pdf2docx import Converter
except ImportError:
    print("Error: pdf2docx module not found. Please ensure it is installed.")
    sys.exit(1)

def convert_pdf(pdf_file, docx_file):
    try:
        if not os.path.exists(pdf_file):
            print(f"Error: Input file {pdf_file} does not exist.")
            return False
            
        cv = Converter(pdf_file)
        cv.convert(docx_file, start=0, end=None)
        cv.close()
        return True
    except Exception as e:
        print(f"Error during conversion: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 convert_pdf.py <input_pdf> <output_docx>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    docx_path = sys.argv[2]
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(docx_path), exist_ok=True)
    
    if convert_pdf(pdf_path, docx_path):
        print("Success")
        sys.exit(0)
    else:
        print("Failure")
        sys.exit(1)
