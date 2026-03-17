/**
 * Safe mathematical expression evaluation
 *
 * Only allows numbers and basic operators, preventing code injection
 */
export function calculate(expression: string): number {
  try {
    // Safety check: only allow numbers, operators, parentheses, and spaces
    if (!/^[\d+\-*/().\s]+$/.test(expression)) {
      throw new Error(
        'Invalid expression: only numbers and basic operators allowed',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = eval(expression);
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Invalid calculation result');
    }
    // Precision control: round to 4 decimal places
    return Math.round(result * 10000) / 10000;
  } catch (error) {
    throw new Error(
      `Calculation error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
