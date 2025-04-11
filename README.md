
<h1 align="center">

 📄 AutoGrade API
</h1>
<p align="center">
  <b>AutoGrade</b> is a powerful API service to automate the process of evaluating handwritten answer sheets and extracting structured data from PDFs.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/API-AutoGrade-blueviolet?style=for-the-badge" alt="AutoGrade Badge" />
  <img src="https://img.shields.io/badge/AI_Model-Meta_LLaMA_3-cc00ff?style=for-the-badge" alt="Meta LLaMA Badge" />
  <img src="https://img.shields.io/badge/PDF_Processing-Supported-11aa11?style=for-the-badge" alt="PDF Badge" />
 
<div align="center">
  
  ### 🌐 **API Endpoint**  **🔗 [shop-ease.koyeb.com](https://shop-ease.koyeb.app)** 
  
</div>
 </p>




### 📦 **Deployment Pipeline**

<p align="center">
  <a href="https://koyeb.com">
    <img src="https://img.shields.io/badge/🚀_Hosted_on-Koyeb-24292e?style=for-the-badge&logo=koyeb&logoColor=white" alt="Koyeb Badge" />
  </a>
  <a href="https://www.docker.com/">
    <img src="https://img.shields.io/badge/Containerized-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Badge" />
  </a>
  <a href="https://github.com/features/actions">
    <img src="https://img.shields.io/badge/CI/CD-GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white" alt="GitHub Actions Badge" />
  </a>
</p>



## 🚀 Endpoints

### 1. 🔍 Perform OCR on PDF
**POST** `/perform-ocr`

Extracts text from a PDF by:
- Extracting images from the PDF
- Using Meta LLaMA 90B for OCR and text extraction
- Converting results into structured JSON

#### 📝 Request Body:
```json
{
  "pdfUrl": "URL_TO_YOUR_PDF"
}

```

#### 📦 Sample Response:
```json
{
  "margin_number": "1",
  "answer": "Sample answer extracted from the PDF"
}
```

---

### 2. 📘 Convert PDF to JSON
**POST** `/convert-pdf`

Converts a PDF answer key into structured JSON format using a PDF parsing module.

#### 📝 Request Body:
```json
{
  "pdfUrl": "URL_TO_YOUR_PDF"
}
```

#### 📦 Sample Response:
```json
{
  "questions": [
    {
      "question_number": "1",
      "logic": "Question: QUESTION_TEXT | Definition: X mark | Equation: Y mark | Unit: Z mark \nIrrelevant Data: W mark (max mark: TOTAL marks)",
      "diagram": true
    }
  ]
}
```

---

### 3. 🧠 Evaluate Answer Sheet
**POST** `/evaluate`

Evaluates a student's answer sheet against the answer key using **Meta LLaMA 3.3 70B** for detailed and intelligent grading.

#### 📝 Request Body:
Provide both the student's answers and the answer key in the request.

---

For any questions or issues, feel free to contact:  
📧 **alantomanu501@gmail.com**


<div align="center">

© 2025 AutoGrade. Built with ❤️ by Alanto Manu.

</div>
