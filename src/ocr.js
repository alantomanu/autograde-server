import Together from "together-ai";

function formatAnswersToJson(text) {
    const answers = [];
    const lines = text.split("\n");
    let currentMarginNumber = null;
    let currentAnswer = [];

    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (match) {
            if (currentMarginNumber !== null) {
                answers.push({ marginNumber: parseInt(currentMarginNumber), answer: currentAnswer.join(" ").trim() });
            }
            currentMarginNumber = match[1];
            currentAnswer = [match[2]];
        } else if (currentMarginNumber !== null) {
            currentAnswer.push(line);
        }
    }

    if (currentMarginNumber !== null) {
        answers.push({ marginNumber: parseInt(currentMarginNumber), answer: currentAnswer.join(" ").trim() });
    }

    return { answers };
}

async function processImageWithAI(imageUrl, apiKey) {
    const together = new Together({ apiKey });
    const visionLLM = 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo';

    const output = await together.chat.completions.create({
        model: visionLLM,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'just print margin number and answers as it is for valuvation so no formatting is required and no explanation and donot add any extra text.also donot create custom margin number' },
                    {
                        type: 'image_url',
                        image_url: { url: imageUrl },
                    },
                ],
            },
        ],
    });

    const textOutput = output?.choices[0]?.message?.content || '';
    return formatAnswersToJson(textOutput);
}

export { processImageWithAI }; 