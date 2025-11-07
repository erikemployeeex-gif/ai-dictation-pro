
export enum Screen {
  ManageWords,
  PracticeHub,
  DictationPractice,
  ListeningPractice,
  NewsListeningPractice, // New screen for the news module
  VocabularyQuiz,
  Results,
  Statistics,
  Dictionary,
}

export enum SessionType {
  Dictation = 'Dictation',
  Listening = 'Listening',
  NewsListening = 'NewsListening', // New session type
  Quiz = 'Quiz',
}

export enum DictationLevel {
  Basic = 'Basic',
  Intermediate = 'Intermediate',
  Advanced = 'Advanced',
  Strategic = 'Strategic English Track (Pro)',
}

export interface Word {
  text: string;
  translation?: string;
  errorCount: number;
  usageCount: number;
  lastUsed: string | null;
  dateAdded: string;
}

export interface Dictation {
  title: string;
  fullText: string;
  wordsToGuess: string[];
  textParts: string[];
  shuffledWords: string[];
  imageUrl: string | null;
  level: DictationLevel;
}

export interface Question {
  question: string;
  options: string[];
  correctAnswer: string;
  questionType: 'Literal' | 'Inferential' | 'Analytical' | 'Reflective';
}

export interface ListeningExercise {
  title: string;
  fullText: string;
  questions: Question[];
}

// New interface for the News Listening module
export interface NewsListeningExercise {
  title: string;
  source: string;
  fullText: string;
  questions: Question[];
}


export interface QuizQuestion {
    word: string;
    question: string;
    options: string[];
    correctAnswer: string;
}

export interface QuizExercise {
    title: string;
    questions: QuizQuestion[];
}


export type HistoryEntry = {
  id: string;
  date: string;
  score: number;
} & (
  | {
      type: SessionType.Dictation;
      level: DictationLevel;
      totalWords: number;
      correctWords: number;
      errors: { word: string; userInput: string }[];
    }
  | {
      type: SessionType.Listening;
      exerciseTitle: string;
      questions: Question[];
      userAnswers: string[];
      questionTypeStats: {
        correct: number;
        total: number;
        type: Question['questionType'];
      }[];
    }
  | {
      type: SessionType.NewsListening; // New history entry type
      exerciseTitle: string;
      source: string;
      questions: Question[];
      userAnswers: string[];
    }
  | {
      type: SessionType.Quiz;
      title: string;
      questions: QuizQuestion[];
      userAnswers: string[];
      correctAnswersCount: number;
    }
);