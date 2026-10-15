import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: Request) {
  try {
    const { items } = await request.json();

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      return NextResponse.json({
        recipe: "⚠️ Gemini API key not configured.\n\nTo enable real AI recipes:\n1. Visit https://aistudio.google.com/app/apikey\n2. Create a free API key\n3. Paste it as GEMINI_API_KEY in your frontend/.env file\n4. Restart the dev server"
      });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `I have these food items expiring soon: ${items.join(', ')}.
Suggest 1 creative, easy recipe using as many of these ingredients as possible.
Format your response as:
🍽️ [Recipe Name]
⏱️ Time: [X mins]

🛒 Ingredients:
- [list items]

📝 Steps:
1. [step]
2. [step]
...

💡 Tip: [one quick tip]`;

    const result = await model.generateContent(prompt);
    return NextResponse.json({ recipe: result.response.text() });
  } catch (error) {
    console.error('Recipe error:', error);
    return NextResponse.json({ error: 'Failed to generate recipe' }, { status: 500 });
  }
}
