"use client";

import { useState, useEffect } from "react";

interface TypewriterTextProps {
  words: string[];
  className?: string;
}

type AnimationPhase = "hold" | "delete" | "type";

export function TypewriterText({ words, className = "" }: TypewriterTextProps) {
  const firstWord = words[0] ?? "";
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [displayText, setDisplayText] = useState(firstWord);
  const [phase, setPhase] = useState<AnimationPhase>("hold");
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReduceMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (reduceMotion || words.length <= 1) {
      return;
    }

    const currentWord = words[currentWordIndex] ?? firstWord;

    const timeout = window.setTimeout(() => {
      if (phase === "hold") {
        setPhase("delete");
      } else if (phase === "delete") {
        if (displayText.length > 0) {
          setDisplayText(displayText.slice(0, -1));
        } else {
          setCurrentWordIndex((currentWordIndex + 1) % words.length);
          setPhase("type");
        }
      } else {
        if (displayText.length < currentWord.length) {
          setDisplayText(currentWord.slice(0, displayText.length + 1));
        } else {
          setPhase("hold");
        }
      }
    }, phase === "hold" ? 1800 : phase === "delete" ? 45 : 85);

    return () => clearTimeout(timeout);
  }, [currentWordIndex, displayText, firstWord, phase, reduceMotion, words]);

  const renderedText = reduceMotion || words.length <= 1 ? firstWord : displayText;

  return (
    <span className={className}>
      {firstWord && <span className="sr-only">{firstWord}</span>}
      <span aria-hidden="true">
        {renderedText}
        <span className="caret" />
      </span>
    </span>
  );
}
