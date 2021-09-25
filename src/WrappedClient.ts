import { Client, ClientEvents, Intents, Interaction, Message, User } from "discord.js";
import { ClientEvent } from "./ClientEvent";
import type { ButtonCommand } from "./command/interaction/ButtonCommand";
import { ContextMenuCommand } from "./command/interaction/ContextMenuCommand";
import type { SelectMenuCommand } from "./command/interaction/SelectMenuCommand";
import type { MessageCommand } from "./command/MessageCommand";
import { SlashCommand } from "./command/slash/SlashCommand";
import { Payload } from "./Payload";
import type { ButtonCallback, ContextMenuCallback, SelectMenuCallback, SlashCommandCallback } from "./types";

export class WrappedClient {
	static client: Client;
	prefix = "!";
	messageCommands: { [index: string]: MessageCommand } = {};
	commands: { [index: string]: SlashCommand | ContextMenuCommand | ButtonCommand | SelectMenuCommand } = {};

	constructor(
		prefix?: string,
		intents = [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS]
	) {
		if (prefix) {
			this.prefix = prefix;
		}

		WrappedClient.client = new Client({ intents });
	}

	static getClient(): Client {
		return WrappedClient.client;
	}

	setPrefix(prefix: string): void {
		this.prefix = prefix;
	}

	getPrefix(): string {
		return this.prefix;
	}

	async login(token: string): Promise<void> {
		await WrappedClient.client.login(token);

		this.registerEvent(
			new ClientEvent("ready", true).setCallback(() => {
				console.log("Client logged in!");
				Payload.pushPayloads();
			})
		);

		this.registerEvent(
			new ClientEvent("messageCreate", false).setCallback((message: Message) => {
				const args = message.content.split(" ");
				const command = args.shift();

				if (command && command.startsWith(this.prefix)) {
					const commandData = this.messageCommands[command.substring(this.prefix.length)];

					if (commandData) {
						const author = message.member;
						if (!author) return;
						if (author.user.bot) return;

						const callback = commandData.getCallback();
						if (!callback) return;

						const permissions = commandData.getPermissions();
						if (!permissions) {
							callback(message, args);
							return;
						}

						const flags = permissions.flags;
						if (flags && author.permissions.toArray().some(perm => flags.has(perm))) {
							callback(message, args);
							return;
						}

						const allowed = permissions.allowed;
						const denied = permissions.denied;
						if (!allowed && !denied) {
							callback(message, args);
							return;
						}

						if (denied && author.roles.cache.some(role => denied.has(role.id))) return;
						if (allowed && author.roles.cache.some(role => allowed.has(role.id))) {
							callback(message, args);
							return;
						}

						return;
					}
				}
			})
		);

		this.registerEvent(
			new ClientEvent("interactionCreate", false).setCallback((interaction: Interaction) => {
				let callback = undefined;

				if (interaction.isCommand()) {
					callback = this.commands[interaction.commandName].callback as SlashCommandCallback;
					if (callback) {
						callback(interaction, interaction.options["_hoistedOptions"]);
					}
				}
				if (interaction.isButton()) {
					callback = this.commands[interaction.customId].callback as ButtonCallback;
					if (callback) {
						callback(interaction);
					}
				}
				if (interaction.isContextMenu()) {
					callback = this.commands[interaction.commandName].callback as ContextMenuCallback;
					if (callback) {
						let target: Message | User | undefined = undefined;

						const guild = interaction.guild;
						if (guild) {
							switch (interaction.targetType) {
								case "USER": {
									const member = guild.members.cache.get(interaction.targetId);
									if (member) target = member.user;
									break;
								}
								case "MESSAGE": {
									const channel = interaction.channel;
									if (channel) target = channel.messages.cache.get(interaction.targetId);
									break;
								}
							}
						}

						callback(interaction, target);
					}
				}
				if (interaction.isSelectMenu()) {
					callback = this.commands[interaction.customId].callback as SelectMenuCallback;
					if (callback) {
						callback(interaction);
					}
				}
			})
		);
	}

	registerEvent<K extends keyof ClientEvents>(event: ClientEvent<K>): boolean {
		if (event.callback) {
			if (event.once) {
				console.log(`Registered ${event.name} as once.`);
				WrappedClient.client.once(event.name, event.callback);
			} else {
				console.log(`Registered ${event.name} as once.`);
				WrappedClient.client.on(event.name, event.callback);
			}
		}
		return false;
	}

	registerMessageCommand(command: MessageCommand): boolean {
		if (this.messageCommands[command.name]) {
			console.warn(`A command with name [${command.name}] already exists.`);
			return false;
		}
		if (!command.getCallback()) {
			console.warn(`${command.name} does not have a callback set.`);
			return false;
		}

		this.messageCommands[command.name] = command;
		return true;
	}

	registerCommandObject(command: SlashCommand | ContextMenuCommand | ButtonCommand | SelectMenuCommand): boolean {
		if (this.commands[command.name]) {
			console.warn(`A command with name [${command.name}] already exists.`);
			return false;
		}

		if (!command.getCallback()) {
			console.warn(`${command.name} does not have a callback set.`);
			return false;
		}

		this.commands[command.name] = command;

		if (command instanceof SlashCommand || command instanceof ContextMenuCommand) {
			const guildId = command.getGuildId();
			if (guildId) {
				Payload.addGuildPayload(guildId, command.getData(), command.getPermissions());
			} else {
				Payload.addGlobalPayload(command.getData());
			}
		}

		return true;
	}
}
