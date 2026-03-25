import { ChannelAdapter, ChannelType } from '../types/index.js';
import { lineChannel } from './line.channel.js';
import { messengerChannel } from './messenger.channel.js';
import { whatsappChannel } from './whatsapp.channel.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'ChannelRegistry' });

/**
 * Channel registry: maps channel types to their adapter implementations.
 */
class ChannelRegistry {
  private adapters = new Map<ChannelType, ChannelAdapter>();

  constructor() {
    this.register(lineChannel);
    this.register(messengerChannel);
    this.register(whatsappChannel);
  }

  register(adapter: ChannelAdapter) {
    this.adapters.set(adapter.channelType, adapter);
    log.info({ channel: adapter.channelType }, 'Channel adapter registered');
  }

  get(channelType: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(channelType);
  }

  getAll(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const channelRegistry = new ChannelRegistry();
