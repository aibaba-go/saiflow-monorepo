import { clampPrecision, formatDecimal, isDecimalString, isNegativeDecimal, parseDecimal } from "./decimal";

describe("formatDecimal", () => {
  it("pads and groups thousands", () => {
    expect(formatDecimal("3244.8", 2)).toBe("3,244.80");
  });

  it("rounds half up away from zero, also for negatives", () => {
    expect(formatDecimal("-0.005", 2)).toBe("-0.01");
    expect(formatDecimal("0.005", 2)).toBe("0.01");
    expect(formatDecimal("2.345", 2)).toBe("2.35");
    expect(formatDecimal("1.0049", 2)).toBe("1.00");
  });

  it("keeps every digit of large values (no float)", () => {
    expect(formatDecimal("123456789012345678.123456", 6)).toBe("123,456,789,012,345,678.123456");
    expect(formatDecimal("123456789012345678.123456", 2)).toBe("123,456,789,012,345,678.12");
    expect(formatDecimal("99999999999999999.995", 2)).toBe("100,000,000,000,000,000.00");
  });

  it("carries through all digits and supports precision 0", () => {
    expect(formatDecimal("999.995", 2)).toBe("1,000.00");
    expect(formatDecimal("9.5", 0)).toBe("10");
    expect(formatDecimal("1234", 0)).toBe("1,234");
  });

  it("never shows negative zero", () => {
    expect(formatDecimal("-0.001", 2)).toBe("0.00");
    expect(formatDecimal("-0", 0)).toBe("0");
  });

  it("handles exponents, signs and missing integer parts", () => {
    expect(formatDecimal("1.5e3", 1)).toBe("1,500.0");
    expect(formatDecimal("1E-3", 3)).toBe("0.001");
    expect(formatDecimal("+.5", 1)).toBe("0.5");
  });

  it("clamps precision to 0..6 and honours options", () => {
    expect(formatDecimal("1.23456789", 10)).toBe("1.234568");
    expect(formatDecimal("1234.5", -3)).toBe("1,235");
    expect(formatDecimal("1234.5", 1, { grouping: false })).toBe("1234.5");
    expect(formatDecimal("1234.5", 1, { groupSeparator: ".", decimalSeparator: "," })).toBe("1.234,5");
  });

  it("returns invalid input unchanged", () => {
    expect(formatDecimal("abc", 2)).toBe("abc");
    expect(formatDecimal("", 2)).toBe("");
  });
});

describe("decimal helpers", () => {
  it("parses and classifies strings", () => {
    expect(parseDecimal("-12.50")).toMatchObject({ negative: true });
    expect(parseDecimal("x")).toBeNull();
    expect(isDecimalString("12.5")).toBe(true);
    expect(isDecimalString("12,5")).toBe(false);
    expect(isNegativeDecimal("-0.01")).toBe(true);
    expect(isNegativeDecimal("-0")).toBe(false);
    expect(isNegativeDecimal("5")).toBe(false);
    expect(clampPrecision(undefined)).toBe(2);
    expect(clampPrecision(7)).toBe(6);
    expect(clampPrecision(2.7)).toBe(2);
  });
});
