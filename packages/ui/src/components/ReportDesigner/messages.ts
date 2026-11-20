/**
 * Wording of the report configuration problems. The server (`report_config.py`) speaks plain
 * English; the designer turns the known messages into these texts and shows any other message
 * as it came.
 */
export interface ReportErrorLabels {
  invalid: string;
  periodFrom: string;
  periodTo: string;
  periodOrder: string;
  rowHeight: string;
  maxCards: (n: number) => string;
  needCard: string;
  tooLarge: string;
  maxText: (n: number) => string;
  layout: string;
  overlaps: (other: string) => string;
  precision: string;
  colors: string;
  color: string;
  needTemplate: string;
  templateGone: string;
  needVersions: string;
  versionUnavailable: string;
  versionOther: string;
  needGrain: string;
  needTable: string;
  tableNotInAll: string;
  needMeasure: string;
  needAgg: string;
  needField: string;
  columnOutside: string;
  measureColumn: string;
  fieldMissing: string;
  fieldNotInAll: string;
  fieldTypes: string;
  wrongType: (type: string) => string;
  needTimeGrain: string;
  metricNoDimension: string;
  needDimension: string;
  noSeries: string;
  seriesSame: string;
  needUnit: string;
  unitLength: string;
  confirm: (path: string) => string;
}

export const DEFAULT_REPORT_ERROR_LABELS: ReportErrorLabels = {
  invalid: "The value is not valid",
  periodFrom: "Choose a start date",
  periodTo: "Choose an end date",
  periodOrder: "The period ends before it starts",
  rowHeight: "Row height is a whole number from 20 to 400",
  maxCards: (n) => `A page has at most ${n} cards`,
  needCard: "Add at least one card before publishing",
  tooLarge: "The page configuration is larger than 256 KB",
  maxText: (n) => `At most ${n} characters`,
  layout: "The card must fit the 12 grid columns (height 2–12)",
  overlaps: (other) => `The card overlaps card ${other}`,
  precision: "Decimals is a whole number from 0 to 6",
  colors: "At most 20 colors",
  color: "A color is #RRGGBB",
  needTemplate: "Choose a template",
  templateGone: "The template is no longer available",
  needVersions: "Choose 1–20 template versions",
  versionUnavailable: "The version is not available",
  versionOther: "The version belongs to another template",
  needGrain: "Choose the data grain",
  needTable: "Choose a detail table",
  tableNotInAll: "The table is not in every selected version",
  needMeasure: "Choose a measure",
  needAgg: "Choose an aggregation",
  needField: "Choose a field",
  columnOutside: "A column can only come from the selected detail table",
  measureColumn: "With a detail table, the measure must be a column of that table",
  fieldMissing: "The field is not in the selected template versions",
  fieldNotInAll: "The field is not in every selected version",
  fieldTypes: "The field has different types in the selected versions",
  wrongType: (type) => `A ${type} field cannot be used here`,
  needTimeGrain: "Choose day, month or year",
  metricNoDimension: "A metric has no dimension",
  needDimension: "This chart needs a date or category dimension",
  noSeries: "This chart has no series",
  seriesSame: "The series must differ from the dimension",
  needUnit: "State the currency or unit of the measure",
  unitLength: "A fixed unit is 1–16 characters",
  confirm: (path) => `Confirm that ${path} means the same in every selected version`,
};

type Rule = [RegExp, (m: RegExpMatchArray, l: ReportErrorLabels) => string];

const RULES: Rule[] = [
  [/^a fixed period needs a valid from date/, (_, l) => l.periodFrom],
  [/^a fixed period needs a valid to date/, (_, l) => l.periodTo],
  [/^the period ends before it starts$/, (_, l) => l.periodOrder],
  [/^row height must be/, (_, l) => l.rowHeight],
  [/^a page has at most (\d+) cards$/, (m, l) => l.maxCards(Number(m[1]))],
  [/^add at least one card before publishing$/, (_, l) => l.needCard],
  [/^the configuration is larger than/, (_, l) => l.tooLarge],
  [/^(?:title )?must be text up to (\d+) characters$/, (m, l) => l.maxText(Number(m[1]))],
  [/^(x must be from|y must be from|h must be from|the card must fit the 12 grid columns)/, (_, l) => l.layout],
  [/^the card overlaps card (.+)$/, (m, l) => l.overlaps(m[1] ?? "")],
  [/^precision must be/, (_, l) => l.precision],
  [/^colors must be a list/, (_, l) => l.colors],
  [/^a color is #RRGGBB$/, (_, l) => l.color],
  [/^a template is required$/, (_, l) => l.needTemplate],
  [/^the template is no longer available$/, (_, l) => l.templateGone],
  [/^choose 1-20 distinct template versions$/, (_, l) => l.needVersions],
  [/^the version is not available$/, (_, l) => l.versionUnavailable],
  [/^the version is of another template$/, (_, l) => l.versionOther],
  [/^grain must be document or table$/, (_, l) => l.needGrain],
  [/^a table grain needs a table/, (_, l) => l.needTable],
  [/^the table is not in every selected version$/, (_, l) => l.tableNotInAll],
  [/^a measure is required$/, (_, l) => l.needMeasure],
  [/^agg must be one of/, (_, l) => l.needAgg],
  [/^a field path is required$/, (_, l) => l.needField],
  [/^a column can only be used from the selected table/, (_, l) => l.columnOutside],
  [/^a table grain measure must be a column/, (_, l) => l.measureColumn],
  [/^the field does not exist in the selected template versions$/, (_, l) => l.fieldMissing],
  [/^the field is not in every selected version$/, (_, l) => l.fieldNotInAll],
  [/^the field has different types/, (_, l) => l.fieldTypes],
  [/^a field of type (\w+) cannot be used here$/, (m, l) => l.wrongType(m[1] ?? "")],
  [/^time grain must be/, (_, l) => l.needTimeGrain],
  [/^a metric card has no dimension$/, (_, l) => l.metricNoDimension],
  [/^this chart needs a date or category dimension$/, (_, l) => l.needDimension],
  [/^this chart has no series$/, (_, l) => l.noSeries],
  [/^the series must differ from the dimension$/, (_, l) => l.seriesSame],
  [/^(the measure needs a currency or unit|unit mode must be fixed or field)$/, (_, l) => l.needUnit],
  [/^a fixed unit is 1-16 characters$/, (_, l) => l.unitLength],
  [/^confirm that (.+) means the same in every selected version$/, (m, l) => l.confirm(m[1] ?? "")],
  [
    /^(.* must be an object.*|.* must be a list.*|must be an integer|must be true or false|configuration version must be 1|the grid has 12 columns|current_year takes no fixed dates|period mode must be .*|a card id is .*|card ids must be unique.*|type must be one of .*|a document grain takes no table|count takes no field|a field path is group.item or group.table.column|kind must be .*|no dimension takes no field|only a date dimension has a time grain|confirmed_paths must be .*)$/,
    (_, l) => l.invalid,
  ],
];

/** The localized text of one problem; an unknown message is returned unchanged. */
export function localizeReportError(message: string, labels: ReportErrorLabels = DEFAULT_REPORT_ERROR_LABELS): string {
  for (const [re, text] of RULES) {
    const m = message.match(re);
    if (m) return text(m, labels);
  }
  return message;
}
