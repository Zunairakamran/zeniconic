import { describe, expect, it } from 'vitest';
import { lastCompletedStage, resumeStage } from '../src/index';
import type { JobRecord } from '../src/index';

const CREATED = '2026-11-15T10:00:00.000Z';

function record(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job_0001_2026-11-15-14-oak-avenue',
    listingId: '2026-11-15-14-oak-avenue',
    stage: 'index',
    status: 'queued',
    attempts: 0,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

describe('resumeStage', () => {
  it('starts a queued job at its stage', () => {
    expect(resumeStage(record())).toBe('index');
  });

  it('reruns the stage that started but did not finish', () => {
    const crashed = record({
      stage: 'plan',
      status: 'running',
      progress: { stage: 'plan', percent: 0 },
    });
    expect(resumeStage(crashed)).toBe('plan');
  });

  it('skips a stage whose progress reached 100', () => {
    const crashed = record({
      stage: 'index',
      status: 'running',
      progress: { stage: 'index', percent: 100 },
    });
    expect(resumeStage(crashed)).toBe('plan');
  });

  it('resumes a failed job after its last completed stage', () => {
    const failed = record({
      stage: 'render',
      status: 'failed',
      attempts: 1,
      error: 'ffmpeg exited with code 1',
      progress: { stage: 'render', percent: 0 },
    });
    expect(resumeStage(failed)).toBe('render');
  });

  it('falls back to the next stage when a record has no progress', () => {
    expect(resumeStage(record({ stage: 'render', status: 'failed' }))).toBe('review');
  });

  it('never goes past done', () => {
    expect(resumeStage(record({ stage: 'review', status: 'running', progress: { stage: 'review', percent: 100 } }))).toBe(
      'done',
    );
    expect(resumeStage(record({ stage: 'done', status: 'running', progress: { stage: 'done', percent: 100 } }))).toBe(
      'done',
    );
  });
});

describe('lastCompletedStage', () => {
  it('is undefined before a queued job has run', () => {
    expect(lastCompletedStage(record())).toBeUndefined();
  });

  it('reports the finished stage when progress is 100', () => {
    const finished = record({
      stage: 'plan',
      status: 'running',
      progress: { stage: 'plan', percent: 100 },
    });
    expect(lastCompletedStage(finished)).toBe('plan');
  });

  it('reports the previous stage when the current one only started', () => {
    const crashed = record({
      stage: 'render',
      status: 'running',
      progress: { stage: 'render', percent: 0 },
    });
    expect(lastCompletedStage(crashed)).toBe('plan');
  });

  it('uses the stage itself when a legacy record has no progress', () => {
    expect(lastCompletedStage(record({ stage: 'index', status: 'failed' }))).toBe('index');
  });
});
