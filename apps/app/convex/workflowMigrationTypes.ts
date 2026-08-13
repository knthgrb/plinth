export type WorkflowMigrationIssueCode =
  | "DUPLICATE_SETTINGS"
  | "SETTINGS_ORGANIZATION_NOT_FOUND"
  | "DUPLICATE_UI_SETTINGS"
  | "UI_SETTINGS_MISMATCH"
  | "DUPLICATE_SETTINGS_EVENT"
  | "SETTINGS_EVENT_MISMATCH"
  | "EVALUATION_TENANT_MISMATCH"
  | "DUPLICATE_EVALUATION_REVIEWER"
  | "EVALUATION_REVIEWER_MISMATCH"
  | "DUPLICATE_EVALUATION_EVENT"
  | "EVALUATION_EVENT_MISMATCH"
  | "APPLICANT_JOB_TENANT_MISMATCH"
  | "WORKFLOW_ACTOR_TENANT_MISMATCH"
  | "DUPLICATE_STAGE_EVENT"
  | "STAGE_EVENT_MISMATCH"
  | "DUPLICATE_APPLICANT_NOTE"
  | "APPLICANT_NOTE_MISMATCH"
  | "DUPLICATE_APPLICANT_INTERVIEW"
  | "APPLICANT_INTERVIEW_MISMATCH"
  | "DUPLICATE_APPLICANT_SCORECARD"
  | "APPLICANT_SCORECARD_MISMATCH"
  | "DUPLICATE_APPLICANT_OFFER"
  | "APPLICANT_OFFER_MISMATCH"
  | "DUPLICATE_CUSTOM_FIELD_DEFINITION"
  | "CUSTOM_FIELD_DEFINITION_MISMATCH"
  | "DUPLICATE_APPLICANT_CUSTOM_VALUE"
  | "APPLICANT_CUSTOM_VALUE_MISMATCH"
  | "CUSTOM_FIELD_VALUE_UNSUPPORTED"
  | "UNEXPECTED_DESTINATION_ROW";

export type WorkflowMigrationIssue = {
  code: WorkflowMigrationIssueCode;
  field: string;
};

export type WorkflowProjectionPlan<T> =
  | { outcome: "create"; value: T }
  | { outcome: "unchanged" }
  | { outcome: "conflict"; issues: WorkflowMigrationIssue[] };

export type WorkflowCustomValueType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

export type WorkflowCustomValue = {
  sourceKey: string;
  valueType: WorkflowCustomValueType;
  valueJson: string;
};
