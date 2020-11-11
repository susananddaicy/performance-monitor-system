'use strict';

module.exports = () => {
    const config = exports = {};

    config.debug = false;


    // ldap
    config.ldap = {
        server: 'ldap://xxx', // ldap服务器地址
        ou: 'xx', // ou
        dc: 'xx', // dc, 非com的另外一层的dc，例如 dc=foobar,dc=com, 这里填 foobar
        isLdap: false, // 是否采用ldap;
    };

    // redis配置
    config.redis = {
        client: {
            port: 6379, // Redis port
            host: '127.0.0.1', // Redis host
            password: '',
            db: 0,
        },
    };

    // mongodb 服务
    const dbclients = {
        db3: {
            // 单机部署
            url: 'mongodb://127.0.0.1:27017/performance',
            // 副本集 读写分离
            // url: 'mongodb://127.0.0.1:28100,127.0.0.1:28101,127.0.0.1:28102/performance?replicaSet=rs1',
            // 集群分片
            // url: 'mongodb://127.0.0.1:30000/performance',
            options: {
                poolSize: 100,
                keepAlive: 10000,
                connectTimeoutMS: 10000,
                autoReconnect: true,
                reconnectTries: 100,
                reconnectInterval: 1000,
            },
        },
    };
    if (config.report_data_type === 'mongodb') {
        dbclients.db1 = {
            // url: 'mongodb://127.0.0.1:27017,127.0.0.1:27018/performance?replicaSet=performance',
            url: 'mongodb://127.0.0.1:27019/performance',
            options: {
                poolSize: 100,
                keepAlive: 10000,
                connectTimeoutMS: 10000,
                autoReconnect: true,
                reconnectTries: 100,
                reconnectInterval: 1000,
            },
        };
    }

    config.security = {
        domainWhiteList: [ 'https://xxx.xx.com' ],
        csrf: {
            enable: false,
            ignore: '/api/v1/report/**',
        },
    };

    // mongoose配置
    config.mongoose = {
        clients: dbclients,
    };

    return config;
};
