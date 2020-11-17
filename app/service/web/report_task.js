'use strict';

const url = require('url');
const querystring = require('querystring');
const UAParser = require('ua-parser-js');
const Service = require('egg').Service;
const fs = require('fs');
const path = require('path');
class ReportTaskService extends Service {

    constructor(params) {
        super(params);
        this.cacheJson = {};
        this.cacheIpJson = {};
        this.cacheArr = [];
        this.system = {};
        // kafka 消费池限制
        this.kafkalist = [];
        this.kafkaConfig = this.app.config.kafka;
        this.kafkatotal = this.kafkaConfig.total_limit_web;
        // 缓存一次ip地址库信息
        this.ipCityFileCache();
    }

    // 获得本地文件缓存
    async ipCityFileCache() {
        this.cacheIpJson = {};
        if (!this.app.config.ip_city_cache_file.isuse) return {};
        try {
            const beginTime = new Date().getTime();
            const filepath = path.resolve(__dirname, `../../cache/${this.app.config.ip_city_cache_file.web}`);
            const ipDatas = fs.readFileSync(filepath, { encoding: 'utf8' });
            const result = JSON.parse(`{${ipDatas.slice(0, -1)}}`);
            this.cacheIpJson = result;
            this.app.logger.info(`--------读取文件城市Ip地址耗时为 ${new Date().getTime() - beginTime}ms-------`);
        } catch (err) {
            this.cacheIpJson = {};
        }
    }

    // 把redis消费数据经过加工之后同步到db3中 的定时任务（从redis中拉取数据）
    async saveWebReportDatasForRedis() {
        // 线程遍历
        const onecount = this.app.config.redis_consumption.thread_web;
        for (let i = 0; i < onecount; i++) {
            this.getWebItemDataForRedis();
        }
    }

    // 单个item储存数据
    async getWebItemDataForRedis() {
        let query = await this.app.redis.rpop('web_repore_datas');
        if (!query) return;
        query = JSON.parse(query);

        const querytype = query.type || 1;
        const item = await this.handleData(query);
        let system = {};
        // 做一次appId缓存
        if (this.cacheJson[item.app_id]) {
            system = this.cacheJson[item.app_id];
        } else {
            system = await this.service.system.getSystemForAppId(item.app_id);
            this.cacheJson[item.app_id] = system;
        }
        // 是否禁用上报
        if (system.is_use !== 0) return;
        if (system.is_statisi_pages === 0 && querytype === 1) this.savePages(item, system.slow_page_time);
        if (system.is_statisi_resource === 0 || system.is_statisi_ajax === 0) this.forEachResources(item, system);
        if (system.is_statisi_error === 0) this.saveErrors(item);
        if (system.is_statisi_system === 0) this.saveEnvironment(item);
    }

    // kafka 消费信息
    async saveWebReportDatasForKafka() {
        if (this.kafkaConfig.consumer) {
            this.app.kafka.consumer('web', message => {
                this.consumerDatas(message);
            });
        } else if (this.kafkaConfig.consumerGroup) {
            this.app.kafka.consumerGroup('web', message => {
                this.consumerDatas(message);
            });
        }
    }

    async consumerDatas(message) {
        try {
            if (!message.value) return;
            const json = {};
            const query = JSON.parse(message.value) || {};
            if (json.time) return;
            json.time = query.time;

            this.getWebItemDataForKafka(query);

        } catch (err) {
            this.app.coreLogger.error(`kafka 消息队列消费消息 error ${err}`);
            console.log(err);
        }
    }

    // 单个item储存数据
    async getWebItemDataForKafka(query) {
        const type = query.type || 1;
        const item = await this.handleData(query);

        let system = {};
        // 做一次appId缓存
        if (this.cacheJson[item.app_id]) {
            system = this.cacheJson[item.app_id];
        } else {
            system = await this.service.system.getSystemForAppId(item.app_id);
            this.cacheJson[item.app_id] = system;
        }
        // 是否禁用上报
        if (system.is_use !== 0) return;

        // kafka 连接池限制
        const msgtab = query.time + query.ip;
        if (this.kafkatotal && this.kafkalist.length >= this.kafkatotal) return;
        this.kafkalist.push(msgtab);

        if (system.is_statisi_pages === 0 && type === 1) {
            this.savePages(item, system.slow_page_time, () => {
                // 释放
                const index = this.kafkalist.indexOf(msgtab);
                if (index > -1) this.kafkalist.splice(index, 1);
            });
        } else {
            // 释放
            const index = this.kafkalist.indexOf(msgtab);
            if (index > -1) this.kafkalist.splice(index, 1);
        }
        if (system.is_statisi_resource === 0 || system.is_statisi_ajax === 0) this.forEachResources(item, system);
        if (system.is_statisi_error === 0) this.saveErrors(item);
        if (system.is_statisi_system === 0) this.saveEnvironment(item);
    }

    // 把db2的数据经过加工之后同步到db3中 的定时任务（从mongodb中拉取数据）
    async saveWebReportDatasForMongodb() {
        let beginTime = await this.app.redis.get('web_task_begin_time');
        const endTime = new Date();
        const query = { create_time: { $lt: endTime } };

        if (beginTime) {
            beginTime = new Date(new Date(beginTime).getTime() + 1000);
            query.create_time.$gt = beginTime;
        }
        /*
        * 请求db1数据库进行同步数据
        *  查询db1是否正常,不正常则重启
        */
        try {
            const datas = await this.ctx.model.Web.WebReport.find(query)
                .read('sp')
                .sort({ create_time: 1 })
                .exec();
            this.app.logger.info(`-----------db1--查询web端db1数据库是否可用---${datas.length}-------`);
            // 储存数据
            this.commonSaveDatas(datas);
        } catch (err) {
            this.app.restartMongodbs('db1', this.ctx, err);
        }
    }

    // 储存数据到db3
    async commonSaveDatas(datas) {
        // 开启多线程执行
        this.cacheJson = {};
        this.cacheArr = [];
        if (datas && datas.length) {
            const length = datas.length;
            const number = Math.ceil(length / this.app.config.report_thread);

            for (let i = 0; i < this.app.config.report_thread; i++) {
                const newSpit = datas.splice(0, number);
                if (datas.length) {
                    this.saveDataToDb3(newSpit);
                } else {
                    this.saveDataToDb3(newSpit, true);
                }
            }
        }
    }

    // 存储数据
    async saveDataToDb3(data, type) {
        if (!data && !data.length) return;
        const length = data.length - 1;

        // 遍历数据
        data.forEach(async (item, index) => {
            let system = {};
            // 做一次appId缓存
            if (this.cacheJson[item.app_id]) {
                system = this.cacheJson[item.app_id];
            } else {
                system = await this.service.system.getSystemForAppId(item.app_id);
                this.cacheJson[item.app_id] = system;
            }

            // 是否禁用上报
            if (system.is_use !== 0) return;

            const querytype = item.type || 1;
            item = await this.handleData({
                type: item.type,
                appId: item.app_id,
                time: item.create_time,
                user_agent: item.user_agent,
                ip: item.ip,
                markPage: item.mark_page || '',
                markUser: item.mark_user || '',
                markUv: item.mark_uv,
                url: item.url,
                preUrl: item.pre_url,
                performance: item.performance,
                errorList: item.error_list,
                resourceList: item.resource_list,
                screenwidth: item.screenwidth,
                screenheight: item.screenheight,
                isFristIn: item.is_first_in,
            });

            if (system.is_statisi_pages === 0 && querytype === 1) this.savePages(item, system.slow_page_time);
            if (system.is_statisi_resource === 0 || system.is_statisi_ajax === 0) this.forEachResources(item, system);
            if (system.is_statisi_error === 0) this.saveErrors(item);
            if (system.is_statisi_system === 0) this.saveEnvironment(item);
            if (index === length && type) this.app.redis.set('web_task_begin_time', item.create_time);
        });
    }

    // 数据操作层
    async handleData(query) {
        const type = query.type || 1;

        let item = {
            app_id: query.appId,
            create_time: new Date(query.time),
            user_agent: query.user_agent,
            ip: query.ip,
            mark_page: query.markPage || this.app.randomString(),
            mark_user: query.markUser || '',
            mark_uv: query.markUv || '',
            url: query.url,
        };

        if (type === 1) {
            // 页面级性能
            if (typeof query.isFristIn !== 'boolean') query.isFristIn = false;
            item = Object.assign(item, {
                is_first_in: query.isFristIn ? 2 : 1,
                pre_url: query.preUrl,
                performance: query.performance,
                error_list: query.errorList,
                resource_list: query.resourceList,
                screenwidth: query.screenwidth,
                screenheight: query.screenheight,
            });
        } else if (type === 2 || type === 3) {
            // AJAX性能
            item = Object.assign(item, {
                error_list: query.errorList,
                resource_list: query.resourceList,
            });
        }
        return item;
    }

    // 储存网页性能数据
    async savePages(item, slowPageTime = 5, fn) {
        try {
            const pages = this.app.models.WebPages(item.app_id)();
            const performance = item.performance;
            if (item.performance && item.performance.lodt > 0) {
                const newurl = url.parse(item.url);
                const newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}${newurl.hash ? newurl.hash : ''}`;

                slowPageTime = slowPageTime * 1000;
                const speedType = performance.lodt >= slowPageTime ? 2 : 1;

                // 算出页面资源大小
                let totalSize = 0;
                const sourslist = item.resource_list || [];
                for (let i = 0; i < sourslist.length; i++) {
                    if (
                        sourslist[i].decodedBodySize &&
                        sourslist[i].type !== 'fetchrequest' &&
                        sourslist[i].type !== 'xmlhttprequest'
                    ) {
                        totalSize += sourslist[i].decodedBodySize;
                    }
                }

                pages.app_id = item.app_id;
                pages.create_time = item.create_time;
                pages.url = newName;
                pages.full_url = item.url;
                pages.pre_url = item.pre_url;
                pages.speed_type = speedType;
                pages.is_first_in = item.is_first_in;
                pages.mark_page = item.mark_page;
                pages.mark_user = item.mark_user;
                pages.load_time = performance.lodt;
                pages.dns_time = performance.dnst;
                pages.tcp_time = performance.tcpt;
                pages.dom_time = performance.domt;
                pages.resource_list = sourslist;
                pages.total_res_size = totalSize;
                pages.white_time = performance.wit;
                pages.redirect_time = performance.rdit;
                pages.unload_time = performance.uodt;
                pages.request_time = performance.reqt;
                pages.analysisDom_time = performance.andt;
                pages.ready_time = performance.radt;
                pages.screenwidth = item.screenwidth;
                pages.screenheight = item.screenheight;
                await pages.save();

                fn && fn();
            } else {
                fn && fn();
            }
        } catch (err) {
            fn && fn();
        }
    }

    // 根据资源类型存储不同数据
    forEachResources(data, system) {
        if (!data.resource_list && !data.resource_list.length) return;

        // 遍历所有资源进行存储
        data.resource_list.forEach(item => {
            if (item.type === 'xmlhttprequest' || item.type === 'fetchrequest') {
                if (system.is_statisi_ajax === 0) this.saveAjaxs(data, item, system.slow_ajax_time);
            } else {
                if (system.is_statisi_resource === 0) this.saveResours(data, item, system);
            }
        });
    }

    // 存储ajax信息
    saveAjaxs(data, item, slowAjaxTime = 2) {
        const newurl = url.parse(item.name);
        const newName = newurl.protocol + '//' + newurl.host + newurl.pathname;
        const querydata = newurl.query ? JSON.stringify(querystring.parse(newurl.query)) : '{}';
        let duration = Math.abs(item.duration || 0);
        if (duration > 60000) duration = 60000;
        slowAjaxTime = slowAjaxTime * 1000;
        const speedType = duration >= slowAjaxTime ? 2 : 1;

        const ajaxs = this.app.models.WebAjaxs(data.app_id)();
        ajaxs.app_id = data.app_id;
        ajaxs.create_time = data.create_time;
        ajaxs.speed_type = speedType;
        ajaxs.url = newName;
        ajaxs.full_url = item.name;
        ajaxs.method = item.method;
        ajaxs.duration = duration;
        ajaxs.decoded_body_size = item.decodedBodySize;
        ajaxs.call_url = data.url;
        ajaxs.options = item.options || querydata;
        ajaxs.mark_page = data.mark_page;
        ajaxs.mark_user = data.mark_user;

        ajaxs.save();
    }

    // 储存网页资源性能数据
    saveResours(data, item, system) {
        let slowTime = 2;
        let speedType = 1;
        let duration = Math.abs(item.duration || 0);
        if (duration > 60000) duration = 60000;

        if (item.type === 'link' || item.type === 'css') {
            slowTime = (system.slow_css_time || 2) * 1000;
        } else if (item.type === 'script') {
            slowTime = (system.slow_js_time || 2) * 1000;
        } else if (item.type === 'img') {
            slowTime = (system.slow_img_time || 2) * 1000;
        } else {
            slowTime = 2 * 1000;
        }

        speedType = duration >= slowTime ? 2 : 1;
        // 因为相关性能远远 这里只存储慢资源
        if (duration < slowTime) return;

        const newurl = url.parse(item.name);
        const newName = newurl.protocol + '//' + newurl.host + newurl.pathname;

        const resours = this.app.models.WebResource(data.app_id)();
        resours.app_id = data.app_id;
        resours.create_time = data.create_time;
        resours.url = data.url;
        resours.full_url = item.name;
        resours.speed_type = speedType;
        resours.name = newName;
        resours.method = item.method;
        resours.type = item.type;
        resours.duration = duration;
        resours.decoded_body_size = item.decodedBodySize;
        resours.next_hop_protocol = item.nextHopProtocol;
        resours.mark_page = data.mark_page;
        resours.mark_user = data.mark_user;

        resours.save();
    }

    // 存储错误信息
    saveErrors(data) {
        if (!data.error_list || !data.error_list.length) return;
        data.error_list.forEach(item => {
            const newurl = url.parse(item.data.resourceUrl || '');
            const newName = newurl.protocol + '//' + newurl.host + newurl.pathname;
            const querydata = newurl.query ? JSON.stringify(querystring.parse(newurl.query)) : '{}';

            const errors = this.app.models.WebErrors(data.app_id)();
            errors.app_id = data.app_id;
            errors.url = data.url;
            errors.create_time = data.create_time;
            errors.msg = item.msg;
            errors.category = item.n;
            errors.resource_url = newName;
            errors.target = item.data.target;
            errors.type = item.data.type;
            errors.status = item.data.status;
            errors.text = item.data.text;
            errors.col = item.data.col;
            errors.line = item.data.line;
            errors.querydata = querydata;
            errors.method = item.method;
            errors.fullurl = item.data.resourceUrl;
            errors.mark_page = data.mark_page;
            errors.mark_user = data.mark_user;

            errors.save();
        });
    }

    //  储存用户的设备信息
    async saveEnvironment(data) {
        // 检测用户UA相关信息
        const parser = new UAParser();
        parser.setUA(data.user_agent);
        const result = parser.getResult();
        const ip = data.ip;

        if (!ip) return;
        let copyip = ip.split('.');
        copyip = `${copyip[0]}.${copyip[1]}.${copyip[2]}`;
        let datas = null;

        if (this.cacheIpJson[copyip]) {
            datas = this.cacheIpJson[copyip];
        } else if (this.app.config.ip_redis_or_mongodb === 'redis') {
            // 通过reids获得用户IP对应的地理位置信息
            datas = await this.app.redis.get(copyip);
            if (datas) {
                datas = JSON.parse(datas);
                this.cacheIpJson[copyip] = datas;
                this.saveIpDatasInFile(copyip, { city: datas.city, province: datas.province });
            }
        } else if (this.app.config.ip_redis_or_mongodb === 'mongodb') {
            // 通过mongodb获得用户IP对应的地理位置信息
            datas = await this.ctx.model.IpLibrary.findOne({ ip: copyip }).read('sp').exec();
            if (datas) {
                this.cacheIpJson[copyip] = datas;
                this.saveIpDatasInFile(copyip, { city: datas.city, province: datas.province });
            }
        }

        const environment = this.app.models.WebEnvironment(data.app_id)();
        environment.app_id = data.app_id;
        environment.create_time = data.create_time;
        environment.url = data.url;
        environment.mark_page = data.mark_page;
        environment.mark_user = data.mark_user;
        environment.mark_uv = data.mark_uv;
        environment.browser = result.browser.name || '';
        environment.borwser_version = result.browser.version || '';
        environment.system = result.os.name || '';
        environment.system_version = result.os.version || '';
        environment.ip = data.ip;
        environment.county = data.county;
        environment.province = data.province;
        if (datas) {
            environment.province = datas.province;
            environment.city = datas.city;
        }
        environment.save();
    }

    // 保存城市信息到文件中
    saveIpDatasInFile(copyip, json) {
        if (this.cacheArr.includes(copyip)) return;
        this.cacheArr.push(copyip);
        const filepath = path.resolve(__dirname, `../../cache/${this.app.config.ip_city_cache_file.web}`);
        const str = `"${copyip}":${JSON.stringify(json)},`;
        fs.appendFile(filepath, str, { encoding: 'utf8' }, () => {});
    }
}

module.exports = ReportTaskService;
