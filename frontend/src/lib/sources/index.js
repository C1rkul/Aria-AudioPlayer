import { LocalSource } from './local-source.js';
import { ExternalSource } from './external-source.js';

// Реестр всех доступных источников
const providers = [LocalSource, ExternalSource];

/**
 * Найти подходящий провайдер для трека
 */
export function getSourceProvider(track) {
  const provider = providers.find(p => p.canHandle(track));
  if (!provider) {
    throw new Error(`No source provider found for track: ${track.id}`);
  }
  return provider;
}

export { LocalSource, ExternalSource };