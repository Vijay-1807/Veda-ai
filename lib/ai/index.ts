import {
  ANSWER_PROVIDER_ORDER,
  createOrderedProviders,
  createProvidersInOrder,
  QUESTION_PROVIDER_ORDER,
} from "./registry";

export function getProviderChain(phase?: "questions" | "answers") {
  if (phase === "questions") return createProvidersInOrder(QUESTION_PROVIDER_ORDER);
  if (phase === "answers") return createProvidersInOrder(ANSWER_PROVIDER_ORDER);
  return createOrderedProviders();
}
