import { parseProfile } from "./onboarding-profile.ts";

/**
 * Explicit client-facing response shapes. Every client API must return only
 * these whitelisted fields - never the full database row - so internal columns
 * (notably `ownerId`, the coach's Clerk user id) are not leaked to the client.
 *
 * The input types are structural on purpose: the helpers have no runtime
 * imports, which keeps them unit-testable with Node's built-in test runner.
 */

type ClientRow = {
  id: number;
  name: string;
  goal: string;
  sessionsPerWeek: number;
  currentWeight: number | null;
};

type ProgrammeRow = {
  title: string;
  goal: string;
  sessionsPerWeek: number;
  content: string;
};

type ProgressEntryRow = {
  id: number;
  weight: number | null;
  waist: number | null;
  chest: number | null;
  hips: number | null;
  arm: number | null;
  thigh: number | null;
  energy: number;
  sleep: number;
  adherence: number;
  notes: string;
  photoData: string;
  createdAt: Date | string;
};

type WorkoutRow = {
  id: number;
  title: string;
  notes: string;
  status: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
};

type IntakeRow = {
  preferredLanguage: string;
  trainingExperience: string;
  availability: string;
  equipment: string;
  goalsDetail: string;
  trainingConsiderations: string;
  profile?: string | null;
  consentAt: Date | string;
  updatedAt: Date | string;
};

export function publicClient(client: ClientRow) {
  return {
    id: client.id,
    name: client.name,
    goal: client.goal,
    sessionsPerWeek: client.sessionsPerWeek,
    currentWeight: client.currentWeight,
  };
}

export function publicProgramme(programme: ProgrammeRow) {
  return {
    title: programme.title,
    goal: programme.goal,
    sessionsPerWeek: programme.sessionsPerWeek,
    content: programme.content,
  };
}

export function publicProgressEntry(entry: ProgressEntryRow) {
  return {
    id: entry.id,
    weight: entry.weight,
    waist: entry.waist,
    chest: entry.chest,
    hips: entry.hips,
    arm: entry.arm,
    thigh: entry.thigh,
    energy: entry.energy,
    sleep: entry.sleep,
    adherence: entry.adherence,
    notes: entry.notes,
    photoData: entry.photoData,
    createdAt: entry.createdAt,
  };
}

export function publicWorkout<TExercises>(workout: WorkoutRow, exercises: TExercises) {
  return {
    id: workout.id,
    title: workout.title,
    notes: workout.notes,
    status: workout.status,
    startedAt: workout.startedAt,
    completedAt: workout.completedAt,
    exercises,
  };
}

export function publicIntake(intake: IntakeRow) {
  return {
    preferredLanguage: intake.preferredLanguage,
    trainingExperience: intake.trainingExperience,
    availability: intake.availability,
    equipment: intake.equipment,
    goalsDetail: intake.goalsDetail,
    trainingConsiderations: intake.trainingConsiderations,
    // Structured onboarding survey (client's own answers) - parsed to the safe
    // canonical shape; null when the client has no structured profile yet.
    profile: parseProfile(intake.profile),
    consentAt: intake.consentAt,
    updatedAt: intake.updatedAt,
  };
}
