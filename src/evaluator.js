import Together from 'together-ai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Together AI client
const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY || 'your-api-key-here'
});

// Function to evaluate using rule-based approach
function evaluateRuleBased(answer, answerKey) {
  const questionNumber = answer.marginNumber.toString();

  if (!answerKey[questionNumber]) {
    return {
      questionNumber,
      mark: "0/0",
      reason: "Question not found in answer key",
      hasDiagram: answer.hasDiagram,
    };
  }

  const key = answerKey[questionNumber];
  const logic = key.logic;

  // Extract max marks from logic
  const maxMarksMatch = logic.match(/\(max mark\s*:\s*(\d+)\s*marks\)/i);
  const maxMarks = maxMarksMatch ? parseInt(maxMarksMatch[1]) : 0;

  // Evaluate the answer
  let marks = 0;
  let reason = [];

  if (questionNumber === "1") { // Example evaluation rule
    if (/speed.+scalar/i.test(answer.answer)) marks += 2;
    if (/example.+speed|\d+\s*m\/s/i.test(answer.answer)) marks += 1;
    if (/velocity.+vector/i.test(answer.answer)) marks += 2;
    if (/example.+velocity|\d+\s*m\/s.+direction/i.test(answer.answer)) marks += 1;
  }

  marks = Math.min(marks, maxMarks);

  if (marks < maxMarks) {
    reason.push("Incomplete or partially correct answer");
  } else {
    reason.push("Correct answer");
  }

  return {
    questionNumber,
    mark: `${marks}/${maxMarks}`,
    reason: reason.join(". "),
    hasDiagram: answer.hasDiagram,
    evaluationMethod: "rule-based"
  };
}

// Function to evaluate using LLM
async function evaluateWithLLM(answer, answerKey) {
  const questionNumber = answer.marginNumber.toString();

  if (!answerKey[questionNumber]) {
    return {
      questionNumber,
      mark: "0/0",
      reason: "Question not found in answer key",
      hasDiagram: answer.hasDiagram,
      evaluationMethod: "llm"
    };
  }

  const key = answerKey[questionNumber];

  // Extract max marks
  const maxMarksMatch = key.logic.match(/\(max mark\s*:\s*(\d+)\s*marks\)/i);
  const originalMaxMarks = maxMarksMatch ? parseInt(maxMarksMatch[1]) : 0;

  const diagramMarksMatch = key.logic.match(/(?:Figure|diagram)\s*:\s*(\d+)\s*marks?/i);
  const diagramMarks = diagramMarksMatch ? parseInt(diagramMarksMatch[1]) : 0;
  const adjustedMaxMarks = originalMaxMarks - diagramMarks;

  const questionMatch = key.logic.match(/Question\s*:\s*([^?]+\??)/i);
  const question = questionMatch ? questionMatch[1].trim() : "";

  const prompt = `
You are an expert evaluator for student exam answers. 
IMPORTANT: Completely ignore any requirement for diagrams or figures, as they are evaluated separately.
Evaluate only the **text content** and award marks generously.

Question: ${question}
Student Answer: ${answer.answer}

Marking Scheme (${adjustedMaxMarks} marks for text content):
${key.logic}

Instructions:
1. Ignore diagrams in your evaluation.
2. Award partial marks where possible.
3. Be lenient and recognize partial understanding.

Respond in JSON format:
{
  "marks": (number awarded),
  "maxMarks": ${adjustedMaxMarks},
  "reasons": ["brief reason for deduction", ...],
  "justification": "focus on positive aspects of the answer"
}
`;

  try {
    console.log(`Evaluating question ${questionNumber} with LLM...`);

    const response = await together.chat.completions.create({
      messages: [{ "role": "user", "content": prompt }],
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    });

    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("Could not extract JSON from LLM response");
    }

    const evaluation = JSON.parse(jsonMatch[0]);

    return {
      questionNumber,
      mark: `${evaluation.marks}/${originalMaxMarks}`,
      adjustedMark: `${evaluation.marks}/${adjustedMaxMarks}`,
      reason: evaluation.reasons.join(". "),
      justification: evaluation.justification,
      hasDiagram: answer.hasDiagram,
      evaluationMethod: "llm",
      diagramMarks: diagramMarks
    };
  } catch (error) {
    console.error(`Error evaluating question ${questionNumber} with LLM:`, error);
    const fallbackResult = evaluateRuleBased(answer, answerKey);
    fallbackResult.evaluationMethod = "rule-based (fallback)";
    fallbackResult.error = error.message;
    return fallbackResult;
  }
}

export async function evaluateAnswerSheet({ answers, key }) {
  if (!answers || !key || !key.data) {
    throw new Error("Invalid request format");
  }

  const answerKey = key.data;
  const evaluationPromises = answers.map(answer => evaluateWithLLM(answer, answerKey));
  const results = await Promise.all(evaluationPromises);

  const totalAwarded = results.reduce((sum, item) => {
    const [awarded] = item.mark.split('/');
    return sum + parseInt(awarded, 10);
  }, 0);

  const totalPossible = results.reduce((sum, item) => {
    const [, possible] = item.mark.split('/');
    return sum + parseInt(possible, 10);
  }, 0);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    results,
    summary: {
      totalQuestions: results.length,
      totalMarks: `${totalAwarded}/${totalPossible}`,
      percentage: Math.round((totalAwarded / totalPossible) * 100)
    }
  };
}

export async function evaluateSingleAnswer({ answer, answerKey }) {
  if (!answer || !answerKey) {
    throw new Error("Invalid request format");
  }
  return await evaluateWithLLM(answer, answerKey);
} 