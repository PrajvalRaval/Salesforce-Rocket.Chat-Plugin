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
    IVisitorEmail,
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
import { type } from 'os';

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
        const dialogflowBotUsername: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('dialogflow_bot_username')
        ).value;
        const dialogflowBotPassword: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('dialogflow_bot_password')
        ).value;
        const salesforceChatApiEndpoint: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('salesforce_chat_api_endpoint')
        ).value;
        const salesforceOrganisationId: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('salesforce_organisation_id')
        ).value;
        const salesforceDeploymentId: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('salesforce_deployment_id')
        ).value;
        const salesforceButtonId: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('salesforce_button_id')
        ).value;
        const targetDeptName: string = (
            await read
                .getEnvironmentReader()
                .getSettings()
                .getById('handover_department_name')
        ).value;

        if (message.sender.username === dialogflowBotUsername) {
            return;
        } else if (message.room.type !== 'l') {
            return;
        }

        const lmessage: ILivechatMessage = message;
        const lroom: ILivechatRoom = lmessage.room as ILivechatRoom;
        const LcAgent: IUser = lroom.servedBy ? lroom.servedBy : message.sender;
        const LcVisitor: IVisitor = lroom.visitor;
        const LcVisitorName = LcVisitor.name;

        if (message.text === 'initiate_salesforce_session') {
            // check whether the bot is currently handling the Visitor, if not then return back
            if (dialogflowBotUsername !== LcAgent.username) {
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
                `${salesforceChatApiEndpoint}System/SessionId`,
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
                            'X-LIVEAGENT-API-VERSION': '48',
                            'X-LIVEAGENT-AFFINITY': sessionIdResponseJSON.affinityToken,
                            'X-LIVEAGENT-SESSION-KEY': sessionIdResponseJSON.key,
                            'X-LIVEAGENT-SEQUENCE': '1',
                        },
                        data: {
                            organizationId: salesforceOrganisationId,
                            deploymentId: salesforceDeploymentId,
                            buttonId: salesforceButtonId,
                            sessionId: sessionIdResponseJSON.id,
                            userAgent: 'Lynx/2.8.8',
                            language: 'en-US',
                            screenResolution: '1900x1080',
                            visitorName: LcVisitorName,
                            prechatDetails: [],
                            prechatEntities: [],
                            receiveQueueUpdates: true,
                            isPost: true,
                        },
                    };

                    http.post(
                        `${salesforceChatApiEndpoint}Chasitor/ChasitorInit`,
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
                                'X-LIVEAGENT-API-VERSION': '48',
                                'X-LIVEAGENT-AFFINITY':
                                sessionIdResponseJSON.affinityToken,
                                'X-LIVEAGENT-SESSION-KEY': sessionIdResponseJSON.key,
                            },
                        };

                        http.get(
                            `${salesforceChatApiEndpoint}System/Messages`,
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

                            let retries = 20;

                            const callback = (data?, error?) => {
                                    // consume data
                                    if (error) {
                                        console.error(error);
                                        return;
                                    }
                                    console.log(data);
                                    retries = 0;

                                    const authHttpRequest: IHttpRequest = {
                                        headers: {
                                            'Content-Type': 'application/json',
                                        },
                                        data: {
                                            user: dialogflowBotUsername,
                                            password: dialogflowBotPassword,
                                        },
                                    };

                                    http.post('http://localhost:3000/api/v1/login', authHttpRequest).then(
                                        (loginResponse) => {
                                            // console.log(loginResponse.content);
                                            const loginResponseJSON = JSON.parse((loginResponse.content || '{}'));
                                            console.log('loginResponseJSON.data.userId --> ' + loginResponseJSON.data.userId);
                                            console.log('loginResponseJSON.data.authToken --> ' + loginResponseJSON.data.authToken);
                                            console.log('message.room.id --> ' + message.room.id);

                                            const deptHttpRequest: IHttpRequest = {
                                                headers: {
                                                    'X-Auth-Token': loginResponseJSON.data.authToken,
                                                    'X-User-Id': loginResponseJSON.data.userId,
                                                },
                                            };
                                            // http_request_no_2 --> get department id
                                            http.get('http://localhost:3000/api/v1/livechat/department', deptHttpRequest).then(
                                                (deptResponse) => {
                                                    const deptResponseJSON = JSON.parse((deptResponse.content || '{}'));
                                                    // console.log(deptResponseJSON);
                                                    let targetDeptId: string = '';
                                                    deptResponseJSON.departments.forEach(
                                                        (department) => {
                                                            if (department.name === targetDeptName) {
                                                                targetDeptId = department._id;
                                                            }
                                                        },
                                                    );

                                                    console.log('Target Dept Id --> ' + targetDeptId);

                                                    // http_request_no_3 --> make handover request
                                                    const ForwardHttpRequest: IHttpRequest = {
                                                        headers: {
                                                            'Content-Type': 'application/json',
                                                            'X-Auth-Token': loginResponseJSON.data.authToken,
                                                            'X-User-Id': loginResponseJSON.data.userId,
                                                        },
                                                        data: {
                                                            roomId: message.room.id,
                                                            departmentId: targetDeptId,
                                                        },
                                                    };
                                                    http.post('http://localhost:3000/api/v1/livechat/room.forward', ForwardHttpRequest).then(
                                                        (forwardResponse) => {
                                                            console.log('room.forward response --> ' + forwardResponse);
                                                        },
                                                    );
                                                },
                                            );
                                        },
                                    );

                                };

                            // tslint:disable-next-line: no-shadowed-variable
                            function request(callback) {
                                http.get(
                                    `${salesforceChatApiEndpoint}System/Messages`,
                                    pullingHttpRequest,
                                ).then((response) => {
                                    // request successful

                                    const t = response.content;
                                    const tk = JSON.parse(t || '{}');

                                    if (tk.messages[0]) {

                                        if (tk.messages[0].type === 'ChatEstablished') {
                                            // server done, deliver data to script to consume
                                            callback(response);
                                        }

                                    } else {
                                        // server not done yet
                                        // retry, if any retries left
                                        if (retries > 0) {
                                            --retries;
                                            request(callback);
                                        } else {
                                            // no retries left, calling callback with error
                                            callback([], 'out of retries');
                                        }
                                    }
                                }).catch((error) => {
                                    // ajax error occurred
                                    // would be better to not retry on 404, 500 and other unrecoverable HTTP errors
                                    // retry, if any retries left
                                    if (retries > 0) {
                                        --retries;
                                        request(callback);
                                    } else {
                                        // no retries left, calling callback with error
                                        callback([], error);
                                    }
                                });
                            }

                            request(callback);
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

        if ('salesforce.agent' === LcAgent.username) {

            const sendMessageHttpRequest: IHttpRequest = {
                headers: {
                    'X-LIVEAGENT-API-VERSION': '48',
                    'X-LIVEAGENT-AFFINITY': 'f4941fa0',
                    'X-LIVEAGENT-SESSION-KEY': '99fef40f-a3e4-4e42-a86c-a4964f7a59f9!1592235600340!0uBrBJJFF9gDQVCMHVSvAIbKi14=',
                },
                data: {
                    text: message.text,
                },
            };

            http.post(
                `${salesforceChatApiEndpoint}Chasitor/ChatMessage`,
                sendMessageHttpRequest,
            ).then((res) => {
                console.log(res);
            });

        // console.log('this is sessionSFaffinity ' + wjqdent);
        }

    }

    protected async extendConfiguration(
        configuration: IConfigurationExtend,
    ): Promise<void> {
        const dialogflowBotUsername: ISetting = {
            id: 'dialogflow_bot_username',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Dialogflow Bot Username',
            required: true,
        };
        const dialogflowBotPassword: ISetting = {
            id: 'dialogflow_bot_password',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Dialogflow Bot Password',
            required: true,
        };
        const salesforceChatApiEndpoint: ISetting = {
            id: 'salesforce_chat_api_endpoint',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Salesforce Chat Enpoint',
            i18nDescription:
                'To find this value, go to your Salesforce Dashboard -> Setup (In Gear Icon) -> Quick Find Search -> Type in: chat setting -> Click on Chat Settings option -> Copy Chat API Endpoint value.',
            required: true,
        };
        const salesforceOrganisationId: ISetting = {
            id: 'salesforce_organisation_id',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Salesforce Organization ID',
            i18nDescription:
                'To find this value, go to your Salesforce Dashboard -> Setup (In Gear Icon) -> Quick Find Search -> Type in: company information -> Click on Company Information option -> Copy Salesforce.com Organization ID	value.',
            required: true,
        };
        const salesforceDeploymentId: ISetting = {
            id: 'salesforce_deployment_id',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Salesforce Deployment ID',
            i18nDescription:
                'To find this value, go to your Salesforce Dashboard -> Setup (In Gear Icon) -> Quick Find Search -> Type in: embedded service deployments -> Click on Embedded Service Deployments option -> Locate current chat group and click on View -> From Embedded Service Code Snippets option, click on Get Code -> Locate the value of deploymentId from Chat Code Snippet.',
            required: true,
        };
        const salesforceButtonId: ISetting = {
            id: 'salesforce_button_id',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Salesforce Button ID',
            i18nDescription:
                'To find this value, go to your Salesforce Dashboard -> Setup (In Gear Icon) -> Quick Find Search -> Type in: embedded service deployments -> Click on Embedded Service Deployments option -> Locate current chat group and click on View -> From Embedded Service Code Snippets option, click on Get Code -> Locate the value of buttonId from Chat Code Snippet.',
            required: true,
        };
        const handoverTargetDepartmentName: ISetting = {
            id: 'handover_department_name',
            public: true,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'Handover Target Department Name',
            required: true,
        };

        configuration.settings.provideSetting(dialogflowBotUsername);
        configuration.settings.provideSetting(dialogflowBotPassword);
        configuration.settings.provideSetting(salesforceChatApiEndpoint);
        configuration.settings.provideSetting(salesforceOrganisationId);
        configuration.settings.provideSetting(salesforceDeploymentId);
        configuration.settings.provideSetting(salesforceButtonId);
        configuration.settings.provideSetting(handoverTargetDepartmentName);
    }
}
