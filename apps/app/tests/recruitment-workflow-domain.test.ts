import { describe, expect, it } from "vitest";
import {
  allowedApplicantTransitions,
  assertApplicantTransition,
  getApplicantStageAge,
  summarizeRecruitmentPipeline,
  validateScorecard,
} from "../lib/recruitment/workflow";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 14);

describe("recruitment workflow domain", () => {
  it("offers only the governed next stages", () => {
    expect(allowedApplicantTransitions("new")).toEqual([
      "screening",
      "rejected",
    ]);
    expect(allowedApplicantTransitions("screening")).toEqual([
      "interview",
      "assessment",
      "rejected",
    ]);
    expect(allowedApplicantTransitions("offer")).toEqual(["rejected"]);
    expect(allowedApplicantTransitions("hired")).toEqual([]);
  });

  it("rejects stage skipping and direct offer or hire movement", () => {
    expect(() => assertApplicantTransition("new", "assessment", {})).toThrow(
      "cannot move from New to Assessment",
    );
    expect(() => assertApplicantTransition("assessment", "offer", {})).toThrow(
      "offer approval workflow",
    );
    expect(() => assertApplicantTransition("offer", "hired", {})).toThrow(
      "employee conversion workflow",
    );
  });

  it("requires a reason to reject and permits controlled reopening", () => {
    expect(() =>
      assertApplicantTransition("screening", "rejected", {
        rejectionReason: " ",
      }),
    ).toThrow("rejection reason");
    expect(() =>
      assertApplicantTransition("screening", "rejected", {
        rejectionReason: "Experience does not match the role",
      }),
    ).not.toThrow();
    expect(() =>
      assertApplicantTransition("rejected", "screening", {}),
    ).not.toThrow();
  });

  it("locks the pipeline after employee conversion", () => {
    expect(() =>
      assertApplicantTransition("hired", "rejected", {
        convertedEmployeeId: "employee-1",
      }),
    ).toThrow("already been converted");
  });

  it("calculates age from the latest current-stage event", () => {
    expect(
      getApplicantStageAge(
        {
          status: "interview",
          appliedDate: NOW - 20 * DAY,
          pipelineStageHistory: [
            { to: "screening", changedAt: NOW - 10 * DAY },
            { to: "interview", changedAt: NOW - 3 * DAY },
          ],
        },
        NOW,
      ),
    ).toEqual({ enteredAt: NOW - 3 * DAY, days: 3, isStale: false });
  });

  it("flags a stage as stale after seven full days", () => {
    expect(
      getApplicantStageAge(
        {
          status: "screening",
          appliedDate: NOW - 8 * DAY,
          pipelineStageHistory: [],
        },
        NOW,
      ).isStale,
    ).toBe(true);
  });

  it("validates scorecard ranges and derives the mean score", () => {
    expect(
      validateScorecard([
        { label: "Role expertise", score: 4 },
        { label: "Communication", score: 2 },
      ]),
    ).toEqual({ overallScore: 3 });
    expect(() =>
      validateScorecard([{ label: "Role expertise", score: 6 }]),
    ).toThrow("between 1 and 5");
    expect(() => validateScorecard([])).toThrow("at least one criterion");
  });

  it("summarizes positions, openings, pipeline stages, and stale candidates", () => {
    const summary = summarizeRecruitmentPipeline(
      [
        { id: "job-1", status: "open", numberOfOpenings: 2 },
        { id: "job-2", status: "closed", numberOfOpenings: 1 },
      ],
      [
        {
          jobId: "job-1",
          status: "screening",
          appliedDate: NOW - 8 * DAY,
          pipelineStageHistory: [],
        },
        {
          jobId: "job-1",
          status: "hired",
          appliedDate: NOW - 20 * DAY,
          pipelineStageHistory: [{ to: "hired", changedAt: NOW - DAY }],
        },
        {
          jobId: "job-2",
          status: "rejected",
          appliedDate: NOW - 3 * DAY,
          pipelineStageHistory: [],
        },
      ],
      NOW,
    );

    expect(summary).toEqual({
      activePositions: 1,
      openHeadcount: 1,
      totalApplicants: 3,
      activeCandidates: 1,
      awaitingDecision: 0,
      staleCandidates: 1,
      stageCounts: {
        new: 0,
        screening: 1,
        interview: 0,
        assessment: 0,
        offer: 0,
        hired: 1,
        rejected: 1,
      },
    });
  });
});
