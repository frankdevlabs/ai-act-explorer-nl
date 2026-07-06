import questionnaireJson from "../../../data/questionnaire/assessment-v1.json";
import type { Questionnaire } from "./types";

const questionnaire = questionnaireJson as unknown as Questionnaire;

export function getQuestionnaire(): Questionnaire {
  return questionnaire;
}
