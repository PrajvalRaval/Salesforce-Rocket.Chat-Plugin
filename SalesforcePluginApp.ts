import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    IHttpRequest,
    IHttpResponse,
    ILogger,
    IMessageBuilder,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import {
    ILivechatMessage,
    ILivechatRoom,
    ILivechatTransferData,
    IVisitor,
} from '@rocket.chat/apps-engine/definition/livechat';
import {
    IMessage,
    IPostMessageSent,
} from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import {
    ISetting,
    SettingType,
} from '@rocket.chat/apps-engine/definition/settings';
import { IUser } from '@rocket.chat/apps-engine/definition/users';

export class SalesforcePluginApp extends App implements IPostMessageSent {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async initialize(
        configurationExtend: IConfigurationExtend,
        environmentRead: IEnvironmentRead,
    ): Promise<void> {
        await this.extendConfiguration(configurationExtend);
        this.getLogger().log('App Initialized');
    }

    public async executePostMessageSent(
        message: IMessage,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify,
    ): Promise<void> {
        const dfbotusername: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('dfbotusername')
        ).value;
        const SalesforceEndpoint: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('salesforcechatendpoint')
        ).value;

        if (message.sender.username === dfbotusername) {
            return;
        } else if (message.room.type !== 'l') {
            return;
        }

        const lmessage: ILivechatMessage = message;
        const lroom: ILivechatRoom = lmessage.room as ILivechatRoom;
        const LcAgent: IUser = lroom.servedBy ? lroom.servedBy : message.sender;

        this.getLogger().log('admin username --> ' + dfbotusername);

        if (message.text === 'initiate_salesforce_session') {
            // check whether the bot is currently handling the Visitor, if not then return back
            if (dfbotusername !== LcAgent.username) {
                return;
            }

            const initiateMessageBuilder = modify
                .getNotifier()
                .getMessageBuilder();
            initiateMessageBuilder
                .setRoom(message.room)
                .setText('Initiating Session With Salesforce')
                .setSender(LcAgent);
            modify.getCreator().finish(initiateMessageBuilder);

            const sessionIdHttpRequest: IHttpRequest = {
                headers: {
                    'X-LIVEAGENT-API-VERSION': '48',
                    'X-LIVEAGENT-AFFINITY': 'null',
                },
            };

            http.get(
                `${SalesforceEndpoint}System/SessionId`,
                sessionIdHttpRequest,
            ).then((res) => {
                if (res) {
                    const { content } = res;

                    console.log('SESSION INITIATION RESPONSE:');
                    console.log(content);

                    const sessionIdResponseJSON = JSON.parse(content || '{}');

                    const sessionIdkey = JSON.stringify(sessionIdResponseJSON, null, '\t');

                    const sessionIdbuilder = modify.getNotifier().getMessageBuilder();
                    sessionIdbuilder
                        .setRoom(message.room)
                        .setText(
                            `Session Initiated With Saleforce:

                        ${sessionIdkey}
                        `,
                        )
                        .setSender(LcAgent);
                    modify.getCreator().finish(sessionIdbuilder);

                    const sendChatRequestHttpRequest: IHttpRequest = {
                        headers: {
                            'X-LIVEAGENT-API-VERSION': '34',
                            'X-LIVEAGENT-AFFINITY': sessionIdResponseJSON.affinityToken,
                            'X-LIVEAGENT-SESSION-KEY': sessionIdResponseJSON.key,
                            'X-LIVEAGENT-SEQUENCE': '1',
                        },
                        data: {
                            organizationId: '00D2x000005MYbl',
                            deploymentId: '5722x000000PXmD',
                            buttonId: '5732x000000PYrK',
                            sessionId: sessionIdResponseJSON.id,
                            userAgent: 'Lynx/2.8.8',
                            language: 'en-US',
                            screenResolution: '1900x1080',
                            visitorName: 'Live Chat Test User',
                            prechatDetails: [],
                            prechatEntities: [],
                            receiveQueueUpdates: true,
                            isPost: true,
                        },
                    };

                    http.post(
                        `${SalesforceEndpoint}Chasitor/ChasitorInit`,
                        sendChatRequestHttpRequest,
                    ).then((chatReqRes) => {
                        console.log('chatReqRes response');
                        console.log(chatReqRes);

                        const chatReqReskey = JSON.stringify(
                            chatReqRes,
                            null,
                            '\t',
                        );

                        const chatReqResbuilder = modify
                            .getNotifier()
                            .getMessageBuilder();
                        chatReqResbuilder
                            .setRoom(message.room)
                            .setText(
                                `Sent A Chat Request To Salesforce:

                        ${chatReqReskey}
                        `,
                            )
                            .setSender(LcAgent);
                        modify.getCreator().finish(chatReqResbuilder);

                        const pullingHttpRequest: IHttpRequest = {
                            headers: {
                                'X-LIVEAGENT-API-VERSION': '34',
                                'X-LIVEAGENT-AFFINITY':
                                sessionIdResponseJSON.affinityToken,
                                'X-LIVEAGENT-SESSION-KEY': sessionIdResponseJSON.key,
                            },
                        };

                        http.get(
                            `${SalesforceEndpoint}System/Messages`,
                            pullingHttpRequest,
                        ).then((pullingResponse) => {
                            console.log('pullingHttpRequest');
                            console.log(pullingResponse);

                            const pullingContent = pullingResponse.content;
                            const pullingKey = JSON.parse(pullingContent || '{}');

                            const pullingResponsekeybuilder = modify
                                .getNotifier()
                                .getMessageBuilder();
                            pullingResponsekeybuilder
                                .setRoom(message.room)
                                .setText(
                                    `Pulling Status From The Server:

                        Current Status: ${pullingKey.messages[0].type}
                        `,
                                )
                                .setSender(LcAgent);
                            modify
                                .getCreator()
                                .finish(pullingResponsekeybuilder);

                            const ForwardHttpRequest: IHttpRequest = {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Auth-Token':
                                        'RailusOoXTkehC4hvLabWHjgqwSbIaFH8v0Q1mtzCyi',
                                    'X-User-Id': 'CYEpLMFjBZ4kEdepW',
                                },
                                data: {
                                    roomId: message.room.id,
                                    departmentId: '5euwwL5x6JCp9Pq4S',
                                },
                            };
                            http.post(
                                'http://localhost:3000/api/v1/livechat/room.forward',
                                ForwardHttpRequest,
                            ).then((forwardResponse) => {
                                console.log(
                                    'room.forward response --> ' +
                                        forwardResponse,
                                );
                            });
                        });
                    });
                } else {
                    const builder = modify.getNotifier().getMessageBuilder();
                    builder
                        .setRoom(message.room)
                        .setText('Error Generating Session Id.')
                        .setSender(LcAgent);
                    modify.getCreator().finish(builder);
                }
            });
        }
    }

    protected async extendConfiguration(
        configuration: IConfigurationExtend,
    ): Promise<void> {
        const dfbotusername: ISetting = {
            id: 'dfbotusername',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Dialogflow Bot Username',
            required: true,
        };
        const salesforcechatendpoint: ISetting = {
            id: 'salesforcechatendpoint',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Saleforce Chat Enpoint',
            i18nDescription:
                'To find this value, go to your Salesforce Dashboard -> Setup (In Gear Icon) -> Quick Find Search -> Type in chat setting -> Click on Chat Settings option',
            required: true,
        };

        configuration.settings.provideSetting(dfbotusername);
        configuration.settings.provideSetting(salesforcechatendpoint);
    }
}
