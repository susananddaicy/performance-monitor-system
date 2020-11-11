'use strict';

const Service = require('egg').Service;

class PvuvipService extends Service {

    // 保存用户上报的数据
    async getPvUvIpData(appId, beginTime, endTime) {
        const querydata = { app_id: appId, type: 1, create_time: { $gte: new Date(beginTime), $lt: new Date(endTime) } };
        return await this.ctx.model.Web.WebPvuvip.find(querydata).read('sp').exec();
    }
    // 历史概况
    async getHistoryPvUvIplist(appId) {
        const query = { app_id: appId, type: 2 };
        return await this.ctx.model.Web.WebPvuvip.find(query)
            .read('sp')
            .sort({ create_time: -1 })
            .limit(5)
            .exec();
    }
    // 查询某日概况
    async getPvUvIpSurveyOne(appId, beginTime, endTime) {
        const query = { app_id: appId, type: 2, create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } };
        const data = await this.ctx.model.Web.WebPvuvip.findOne(query).read('sp').exec();
        if (data) return data;
        // 不存在则储存
        const pvuvipdata = await this.getPvUvIpSurvey(appId, beginTime, endTime, true);
        const result = await this.savePvUvIpData(appId, beginTime, 2, pvuvipdata);
        return result;
    }
    // 概况统计
    async getPvUvIpSurvey(appId, beginTime, endTime, type) {
        const querydata = { create_time: { $gte: new Date(beginTime), $lt: new Date(endTime) } };
        const pv = Promise.resolve(this.pv(appId, querydata));
        const uv = Promise.resolve(this.uv(appId, querydata));
        const ip = Promise.resolve(this.ip(appId, querydata));
        const ajax = Promise.resolve(this.ajax(appId, querydata));
        const flow = Promise.resolve(this.flow(appId, querydata));
        let json = {};
        if (!type) {
            const data = await Promise.all([ pv, uv, ip, ajax, flow ]);
            json = {
                pv: data[0] || 0,
                uv: data[1].length ? data[1][0].count : 0,
                ip: data[2].length ? data[2][0].count : 0,
                ajax: data[3] || 0,
                flow: data[4] || 0,
            };
        } else {
            const user = Promise.resolve(this.user(appId, querydata));
            const bounce = Promise.resolve(this.bounce(appId, querydata));
            const data = await Promise.all([ pv, uv, ip, ajax, user, bounce, flow ]);
            json = {
                pv: data[0] || 0,
                uv: data[1].length ? data[1][0].count : 0,
                ip: data[2].length ? data[2][0].count : 0,
                ajax: data[3],
                user: data[4].length ? data[4][0].count : 0,
                bounce: data[5] || 0,
                flow: data[6] || 0,
            };
        }
        return json;
    }
    // pv
    async pv(appId, querydata) {
        return this.app.models.WebPages(appId).count(querydata).read('sp')
            .exec();
    }
    // ajax
    async ajax(appId, querydata) {
        return this.app.models.WebAjaxs(appId).count(querydata).read('sp')
            .exec();
    }
    // uv
    async uv(appId, querydata) {
        return this.app.models.WebEnvironment(appId).aggregate([
            { $match: querydata },
            { $project: { mark_uv: true } },
            { $group: { _id: '$mark_uv' } },
            { $group: { _id: null, count: { $sum: 1 } } },
        ]).read('sp')
            .exec();
    }
    // ip
    async ip(appId, querydata) {
        return this.app.models.WebEnvironment(appId).aggregate([
            { $match: querydata },
            { $project: { ip: true } },
            { $group: { _id: '$ip' } },
            { $group: { _id: null, count: { $sum: 1 } } },
        ]).read('sp')
            .exec();
    }
    // user
    async user(appId, querydata) {
        return this.app.models.WebEnvironment(appId).aggregate([
            { $match: querydata },
            { $project: { mark_user: true } },
            { $group: { _id: '$mark_user' } },
            { $group: { _id: null, count: { $sum: 1 } } },
        ]).read('sp')
            .exec();
    }
    // 跳出率
    async bounce(appId, querydata) {
        const option = {
            map: function () { emit(this.mark_user, 1); }, // eslint-disable-line
            reduce: function (key, values) { return values.length == 1 }, // eslint-disable-line
            query: querydata,
            out: { replace: 'webjumpout' },
        };
        const res = await this.app.models.WebEnvironment(appId).mapReduce(option);
        const result = await res.model.find().where('value').equals(1)
            .count()
            .exec();
        return result;
    }
    // 流量消费
    async flow(appId, querydata) {
        const pagequery = Object.assign({}, querydata, { is_first_in: 2 });
        const pageflow = Promise.resolve(this.app.models.WebPages(appId).aggregate([
            { $match: pagequery },
            { $group: { _id: null, amount: { $sum: '$total_res_size' } } },
        ]).read('sp')
            .exec());
        const ajaxflow = Promise.resolve(this.app.models.WebAjaxs(appId).aggregate([
            { $match: querydata },
            { $group: { _id: null, amount: { $sum: '$decoded_body_size' } } },
        ]).read('sp')
            .exec());
        const data = await Promise.all([ pageflow, ajaxflow ]);
        const page_flow = data[0].length ? data[0][0].amount : 0;
        const ajax_flow = data[1].length ? data[1][0].amount : 0;
        return page_flow + ajax_flow;
    }
    // 保存pvuvip数据
    async savePvUvIpData(appId, endTime, type, pvuvipdata) {
        const pvuvip = this.ctx.model.Web.WebPvuvip();
        pvuvip.app_id = appId;
        pvuvip.pv = pvuvipdata.pv || 0;
        pvuvip.uv = pvuvipdata.uv || 0;
        pvuvip.ip = pvuvipdata.ip || 0;
        pvuvip.ajax = pvuvipdata.ajax || 0;
        pvuvip.flow = pvuvipdata.flow || 0;
        pvuvip.bounce = pvuvipdata.bounce ? (pvuvipdata.bounce / pvuvipdata.pv * 100).toFixed(2) + '%' : 0;
        pvuvip.depth = pvuvipdata.pv && pvuvipdata.user ? parseInt(pvuvipdata.pv / pvuvipdata.user) : 0;
        pvuvip.create_time = endTime;
        pvuvip.type = type;
        return await pvuvip.save();
    }
}

module.exports = PvuvipService;
