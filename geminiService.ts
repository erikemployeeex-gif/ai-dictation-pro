import { GoogleGenAI, Modality, Type } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";
import { Dictation, DictationLevel, HistoryEntry, Word, ListeningExercise, QuizExercise, Question, SessionType, QuizQuestion, NewsListeningExercise } from '../types';
import { getCache, setCache, createCacheKey } from './cacheService';

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export const generateTranslation = async (word: string): Promise<string | null> => {
  const cacheKey = createCacheKey(['translation', word]);
  const cached = getCache<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const prompt = `Provide 2 or 3 of the most common Spanish translations for the English word "${word}". Return only the translations, separated by commas. For example, for the word "ubiquitous", you should return "ubicuo, omnipresente". Do not add any extra text or explanations.`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const translation = response.text.trim();
    if (translation) {
      setCache(cacheKey, translation);
    }
    return translation;
  } catch (error) {
    console.error(`Error generating translation for "${word}":`, error);
    return 'Error fetching translation.';
  }
};

export const generateDictationText = async (words: string[], challengeWords: string[], level: DictationLevel): Promise<Omit<Dictation, 'imageUrl' | 'level'> | null> => {
  const cacheKey = createCacheKey(['dictation', level, ...words.sort()]);
  const cached = getCache<Omit<Dictation, 'imageUrl' | 'level'>>(cacheKey);
  if (cached) {
    console.log("Serving dictation from cache.");
    return { ...cached, shuffledWords: [...cached.shuffledWords].sort(() => Math.random() - 0.5) };
  }

  let prompt = '';

  if (level === DictationLevel.Strategic) {
    prompt = `You are a thought leader and executive coach creating a dictation exercise for a professional at a C1-C2+ English level. The dictation should be a 2-3 minute long monologue or excerpt.

    **Source Inspiration:** Draw inspiration from the style, depth, and topics found in publications like Harvard Business Review, McKinsey Quarterly, Deloitte Insights, and Gartner.
    
    **Core Themes:** Focus on one or more of the following strategic topics: Leadership, Organizational Agility, Talent Strategy, AI in HR, Change Management, or Purpose-Driven Culture.
    
    **Task:**
    1.  Create a title for the piece.
    2.  Write the full text, naturally integrating the following vocabulary words: ${words.join(', ')}.
    3.  The final output must be structured with the title on the first line, followed by a newline, and then the full paragraph content. Do not use any markdown formatting like bold or asterisks in the paragraph.`;
  } else {
    prompt = `You are an English teacher creating a dictation exercise. Write a short, engaging paragraph based on a recent news story, scientific finding, or professional business context. The paragraph must have a title on the first line, followed by a newline, then the paragraph content. You must naturally integrate the following words: ${words.join(', ')}. Do not use markdown or special formatting like asterisks or bold for these words in the text.`;
    
    if (challengeWords.length > 0) {
      prompt += `\n\nPay special attention to these challenging words for the user: ${challengeWords.join(', ')}. Please craft sentences that provide strong, clear, and unambiguous context to help the user understand their meaning and usage.`;
    }
  }

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const text = response.text;
    const lines = text.split('\n');
    const title = lines[0].trim();
    const fullText = lines.slice(1).join(' ').trim();

    if (!title || !fullText) {
      console.error("Generated text is not in the expected format (Title\\nParagraph).");
      return null;
    }
    
    const wordsRegex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
    const wordsToGuessInOrder = fullText.match(wordsRegex) || [];

    if (wordsToGuessInOrder.length === 0) {
      console.error("None of the provided words were found in the generated text.");
      return null;
    }
    
    const textWithPlaceholders = fullText.replace(wordsRegex, '__BLANK__');
    const textParts = textWithPlaceholders.split('__BLANK__');

    const uniqueLowercaseWords = [...new Set(wordsToGuessInOrder.map(w => w.toLowerCase()))];
    const wordsForBank = words.filter(word => uniqueLowercaseWords.includes(word.toLowerCase()));
    
    const shuffledWords = [...wordsForBank].sort(() => Math.random() - 0.5);

    const result = {
      title,
      fullText,
      wordsToGuess: wordsToGuessInOrder,
      textParts,
      shuffledWords,
    };

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error("Error generating dictation text:", error);
    return null;
  }
};

export const generateListeningExercise = async (words: string[], questionCount: 4 | 8): Promise<ListeningExercise | null> => {
    const cacheKey = createCacheKey(['listening', questionCount, ...words.sort()]);
    const cached = getCache<ListeningExercise>(cacheKey);
    if (cached) {
      console.log("Serving listening exercise from cache.");
      return cached;
    }

    const textLength = questionCount === 4 ? "150-200" : "250-350";
    const questionDistribution = questionCount === 4 ? "1 of each type" : "2 of each type";

    const prompt = `You are an expert in corporate training and English language assessment. Create a "Strategic Listening & Comprehension" module for an advanced professional English learner (C1-C2 level).

    **Input Vocabulary:** The exercise must naturally integrate several of these user-provided words: ${words.join(', ')}.

    **Instructions:**
    1.  **Generate a Context:** Write an original, engaging ${textLength} word text about a professional topic like leadership, HR strategy, change management, innovation, or purpose-driven culture. This text will be read aloud. It should be insightful and thought-provoking.
    2.  **Generate a Title:** Create a suitable title for the text.
    3.  **Generate ${questionCount} Multiple-Choice Questions:** Based *only* on the text you wrote, create ${questionCount} distinct multiple-choice questions. Each question must have exactly 4 options (one correct, three plausible distractors).
        -   **Question Distribution:** Create ${questionDistribution} for each of the following types:
            -   **Literal:** Tests direct understanding of facts stated in the text.
            -   **Inferential:** Tests the ability to deduce meaning that is implied but not explicitly stated.
            -   **Analytical:** Tests the ability to understand relationships between ideas, structure, or purpose within the text.
            -   **Reflective:** Tests the ability to connect the text's concepts to broader principles or personal application.
    4.  **Format:** Return the result as a single JSON object. Do not include any text or markdown outside of the JSON object.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        fullText: { type: Type.STRING },
                        questions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    question: { type: Type.STRING },
                                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    correctAnswer: { type: Type.STRING },
                                    questionType: { type: Type.STRING, enum: ['Literal', 'Inferential', 'Analytical', 'Reflective'] }
                                },
                                required: ["question", "options", "correctAnswer", "questionType"]
                            }
                        }
                    },
                    required: ["title", "fullText", "questions"]
                },
            },
        });

        const jsonStr = response.text.trim();
        const parsed = JSON.parse(jsonStr) as ListeningExercise;
        // Basic validation
        if(parsed.questions.length !== questionCount || !parsed.title || !parsed.fullText) {
            throw new Error("Generated JSON does not match the expected format.");
        }
        setCache(cacheKey, parsed);
        return parsed;

    } catch (error) {
        console.error("Error generating listening exercise:", error);
        return null;
    }
};

export const generateNewsListeningExercise = async (words: string[], questionCount: 4 | 8): Promise<NewsListeningExercise | null> => {
    const cacheKey = createCacheKey(['news-listening', questionCount, ...words.sort()]);
    const cached = getCache<NewsListeningExercise>(cacheKey);
    // News is time-sensitive, so we can use a shorter TTL or just re-fetch, but for this app, caching is fine.
    if (cached) {
      console.log("Serving news listening exercise from cache.");
      return cached;
    }

    const textLength = questionCount === 4 ? "a concise summary of around 200 words" : "a detailed analysis of around 350 words";
    const source = ["Forbes", "The Economist", "Harvard Business Review", "Gallup", "Gartner", "The New York Times (Business Section)"][Math.floor(Math.random() * 6)];

    const prompt = `You are a professional business analyst summarizing a recent, significant news article for an executive audience.

    **Source:** Base your summary on a real, recent (within the last few months) article from a source like **${source}**.
    **Topic:** The article should be about business, innovation, leadership, technology, or the economy.
    **User Vocabulary:** Naturally integrate some of the following words into your summary: ${words.join(', ')}.
    
    **Instructions:**
    1.  **Find & Summarize:** Create ${textLength} of the chosen article. The summary must be insightful and engaging.
    2.  **Create a Title:** Write a compelling title for your summary.
    3.  **Generate ${questionCount} Questions:** Based *only* on your summary, create ${questionCount} multiple-choice questions that test comprehension. Each question must have 4 options (1 correct, 3 distractors). Distribute the question types between Literal, Inferential, and Analytical.
    4.  **Format:** Return the result as a single JSON object. Do not include any text outside the JSON object. The 'source' field should contain the name of the publication you drew inspiration from (e.g., "Forbes").`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-pro", // Using a more advanced model for better news summarization
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        source: { type: Type.STRING },
                        fullText: { type: Type.STRING },
                        questions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    question: { type: Type.STRING },
                                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    correctAnswer: { type: Type.STRING },
                                    questionType: { type: Type.STRING, enum: ['Literal', 'Inferential', 'Analytical', 'Reflective'] }
                                },
                                required: ["question", "options", "correctAnswer", "questionType"]
                            }
                        }
                    },
                    required: ["title", "source", "fullText", "questions"]
                },
            },
        });

        const jsonStr = response.text.trim();
        const parsed = JSON.parse(jsonStr) as NewsListeningExercise;
        if(parsed.questions.length !== questionCount || !parsed.title || !parsed.fullText || !parsed.source) {
            throw new Error("Generated JSON for news exercise does not match the expected format.");
        }
        setCache(cacheKey, parsed);
        return parsed;
    } catch (error) {
        console.error("Error generating news listening exercise:", error);
        return null;
    }
};

export const generateVocabularyQuiz = async (words: string[]): Promise<QuizExercise | null> => {
    const cacheKey = createCacheKey(['quiz', ...words.sort()]);
    const cached = getCache<QuizExercise>(cacheKey);
    if (cached) {
      console.log("Serving quiz from cache.");
      return cached;
    }

    const prompt = `You are a professional English language tutor. Create a vocabulary quiz for an advanced learner based on their word list.

    **Input Words:** ${words.join(', ')}

    **Instructions:**
    1.  **Title:** Create a title for the quiz, like "Vocabulary Checkpoint".
    2.  **Questions:** For each input word, generate one multiple-choice question. The question should test the word's meaning, synonym, or usage in a sentence.
    3.  **Options:** Each question must have exactly 4 options: one correct answer and three plausible distractors. The options should be concise.
    4.  **Format:** Return a single JSON object. The \`questions\` field should be an array of question objects.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        questions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    word: { type: Type.STRING },
                                    question: { type: Type.STRING },
                                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    correctAnswer: { type: Type.STRING }
                                },
                                required: ["word", "question", "options", "correctAnswer"]
                            }
                        }
                    },
                    required: ["title", "questions"]
                }
            }
        });

        const jsonStr = response.text.trim();
        const parsed = JSON.parse(jsonStr) as QuizExercise;
        if (!parsed.title || !parsed.questions || parsed.questions.length === 0) {
            throw new Error("Generated JSON for quiz is invalid.");
        }
        setCache(cacheKey, parsed);
        return parsed;

    } catch (error) {
        console.error("Error generating vocabulary quiz:", error);
        return null;
    }
}

export const generateImageForText = async (prompt: string): Promise<string | null> => {
  const cacheKey = createCacheKey(['image', prompt]);
  const cached = getCache<string>(cacheKey);
  if (cached) {
    console.log("Serving image from cache.");
    return cached;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `A digital art illustration, clean and simple, related to the theme: "${prompt}"`,
          },
        ],
      },
      config: {
          responseModalities: [Modality.IMAGE],
      },
    });
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const base64Data = part.inlineData.data;
        setCache(cacheKey, base64Data);
        return base64Data; // This is the base64 string
      }
    }
    return null;
  } catch (error) {
    console.error("Error generating image:", error);
    return null;
  }
};

export const generateAudio = async (text: string, voiceName: string): Promise<string | null> => {
    const cacheKey = createCacheKey(['audio', voiceName, text]);
    const cached = getCache<string>(cacheKey);
    if(cached) {
      // console.log("Serving audio from cache.");
      return cached;
    }

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: `Read this clearly: ${text}` }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceName },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            setCache(cacheKey, base64Audio);
            return base64Audio;
        }
        return null;
    } catch (error) {
        console.error("Error generating audio:", error);
        return null;
    }
};

export const generatePersonalizedFeedback = async (result: HistoryEntry, words: Word[]): Promise<string | null> => {
    let prompt = '';

    if (result.type === SessionType.Dictation) {
         const errorWords = result.errors.map(e => e.word);
        prompt = `You are a world-class executive language coach. A user has completed an English dictation.

        **Performance Data:**
        - Score: ${result.score.toFixed(1)}%
        - Words they got wrong: ${errorWords.length > 0 ? errorWords.join(', ') : 'None'}

        **Your Task:**
        Provide a short (1-2 sentences), professional, and highly motivational feedback message. Praise their effort and focus on the positive. Frame any mistakes as opportunities. For example: "Excellent work! Precision in these contexts is challenging, and you're making fantastic progress." or "That was a complex piece, and you navigated it well. Each session sharpens your focus." Address the user directly.`;
    } else if (result.type === SessionType.Listening || result.type === SessionType.NewsListening) {
        const correctCount = result.userAnswers.filter((a, i) => a === result.questions[i].correctAnswer).length;
        const total = result.questions.length;
        prompt = `You are an English comprehension coach. A user has completed a "Strategic Listening" exercise.

        **Performance Data:**
        - Overall Score: ${result.score.toFixed(1)}%
        - Correct answers: ${correctCount}/${total}

        **Your Task:**
        Provide positive, actionable feedback. Start with a motivational message like "Great focus on that news briefing!". If the score isn't perfect, frame it as a growth opportunity and give one concrete tip, like focusing on keywords or implied meanings. Keep it to 2-3 sentences and be encouraging.`;
    } else if (result.type === SessionType.Quiz) {
        const incorrectWords = result.questions.filter((q, i) => result.userAnswers[i] !== q.correctAnswer).map(q => q.word);
        prompt = `You are an encouraging vocabulary coach. A user has completed a vocabulary quiz.
        
        **Performance Data:**
        - Score: ${result.score.toFixed(1)}%
        - Words to review: ${incorrectWords.length > 0 ? incorrectWords.join(', ') : 'None'}
        
        **Your Task:**
        Write a short, motivational message. Acknowledge their score positively. If they had errors, suggest a simple next step, like "A quick review of '${incorrectWords[0]}' will solidify it in your memory!". Keep it positive and forward-looking.`;
    }

    if (!prompt) return "Excellent progress! Keep up the great work.";

    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text;
    } catch (error) {
        console.error("Error generating personalized feedback:", error);
        return "Could not generate feedback at this time.";
    }
};

export const generateStatisticsReport = async (weeklyHistory: HistoryEntry[]): Promise<string | null> => {
     if(weeklyHistory.length === 0) {
        return "You haven't completed any exercises this week. Complete a few to get your weekly AI-powered report!";
     }

    const avgScore = weeklyHistory.reduce((acc, h) => acc + h.score, 0) / weeklyHistory.length;
    
    const allDictationErrors = (weeklyHistory
        .filter(h => h.type === SessionType.Dictation) as (HistoryEntry & {type: SessionType.Dictation})[])
        .flatMap(h => h.errors.map(e => e.word));
    
    const errorFrequency: { [key: string]: number } = allDictationErrors.reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
    }, {} as { [key: string]: number });
    
    const mostCommonErrors = Object.entries(errorFrequency).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);

    const prompt = `You are a data analyst and language coach generating a weekly progress report for an English learner. Here is their data from the last 7 days:
- Number of exercises completed: ${weeklyHistory.length}
- Average score across all activities: ${avgScore.toFixed(1)}%
- Most common dictation errors this week: ${mostCommonErrors.length > 0 ? mostCommonErrors.join(', ') : 'None'}

Please generate a brief, insightful summary. Structure it with clear Markdown headings (e.g., "### Key Progress", "### Areas to Focus On", "### This Week's Goal"). Use a positive, encouraging, and professional tone.`;

    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text;
    } catch (error) {
        console.error("Error generating weekly report:", error);
        return "Could not generate report at this time.";
    }
}