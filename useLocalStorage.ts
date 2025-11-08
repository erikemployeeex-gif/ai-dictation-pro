
import { useState, Dispatch, SetStateAction, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue: Dispatch<SetStateAction<T>> = useCallback((value) => {
    setStoredValue(currentState => {
      const newState = value instanceof Function ? value(currentState) : value;
      try {
        window.localStorage.setItem(key, JSON.stringify(newState));
      } catch(error) {
        console.error("Error saving to local storage", error);
      }
      return newState;
    });
  }, [key]);

  return [storedValue, setValue];
}
