'use strict';

const Service = require('egg').Service;

class ErroesService extends Service {

    // 获得ERROR类型列表
    async getAverageErrorList(ctx) {
        const query = ctx.request.query;
        const appId = query.appId;
        const type = query.type || '';
        let pageNo = query.pageNo || 1;
        let pageSize = query.pageSize || this.app.config.pageSize;
        const beginTime = query.beginTime;
        const endTime = query.endTime;
        const url = query.url;

        pageNo = pageNo * 1;
        pageSize = pageSize * 1;

        // 查询参数拼接
        const queryjson = { $match: { } };
        if (type) queryjson.$match.category = type;
        if (url) queryjson.$match.resource_url = { $regex: new RegExp(url, 'i') };
        if (beginTime && endTime) queryjson.$match.create_time = { $gte: new Date(beginTime), $lte: new Date(endTime) };

        const group_id = {
            resourceurl: '$resource_url',
            category: '$category',
            msg: '$msg',
        };

        return url ? await this.oneThread(appId, queryjson, pageNo, pageSize, group_id)
            : await this.moreThread(appId, type, beginTime, endTime, queryjson, pageNo, pageSize, group_id);
    }


    // 平均求值数多线程
    async totalError(ctx) {
        const _query = ctx.request.query;
        const appId = _query.appId;

        const result = [];
        const timeback = new Date().getTime() - 30 * 60 * 1000;

        for(let i = 0; i <= 30; i++ ) {
            const query = { create_time: { $lt: new Date(timeback + i * 60 * 1000) , $gt: new Date(timeback + i * 60 * 1000 - 1 * 60 * 1000) } };
            result.push({
               time:  new Date(timeback + i * 60 * 1000),
               count: await this.app.models.WebErrors(appId).count(query).read('sp').exec()
            })
        }
    
        return {
            datalist: result
        };
    }


    // 平均求值数多线程
    async moreThread(appId, type, beginTime, endTime, queryjson, pageNo, pageSize, group_id) {
        const result = [];
        let distinct = await this.app.models.WebErrors(appId).distinct('resource_url', queryjson.$match).read('sp')
            .exec() || [];
        const copdistinct = distinct;

        const betinIndex = (pageNo - 1) * pageSize;
        if (distinct && distinct.length) {
            distinct = distinct.slice(betinIndex, betinIndex + pageSize);
        }

        const resolvelist = [];
        for (let i = 0, len = distinct.length; i < len; i++) {

            const data = await this.app.models.WebErrors(appId).aggregate([
                (type ?
                    { $match: { category: type, resource_url: distinct[i], create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } } }
                    :
                    { $match: { resource_url: distinct[i], create_time: { $gte: new Date(beginTime), $lte: new Date(endTime) } } }
                ),
                {
                    $group: {
                        _id: group_id,
                        count: { $sum: 1 },
                    },
                },
            ]).read('sp')
                .exec()
            resolvelist.push(data);
        }

        const all = await Promise.all(resolvelist) || [];
   
        all.forEach(item => {
            item.forEach((i) => {
                result.push(i);
            });
        });


        /* eslint-disable */
        result.sort(function (obj1, obj2) {
            let val1 = obj1.count;
            let val2 = obj2.count;
            if (val1 < val2) {
                return 1;
            } else if (val1 > val2) {
                return -1;
            } else {
                return 0;
            }
        });
        /* eslint-enable */

        return {
            datalist: result,
            totalNum: copdistinct.length,
            pageNo,
        };
    }

    // 单个api接口查询平均信息
    async oneThread(appId, queryjson, pageNo, pageSize, group_id) {
        const count = Promise.resolve(this.app.models.WebErrors(appId).distinct('resource_url', queryjson.$match).read('sp')
            .exec());
        const datas = Promise.resolve(
            this.app.models.WebErrors(appId).aggregate([
                queryjson,
                {
                    $group: {
                        _id: group_id,
                        count: { $sum: 1 },
                    },
                },
                { $skip: (pageNo - 1) * pageSize },
                { $sort: { count: -1 } },
                { $limit: pageSize },
            ]).read('sp')
                .exec()
        );
        const all = await Promise.all([ count, datas ]);
        const [ totalNum, datalist ] = all;

        return {
            datalist,
            totalNum: totalNum.length,
            pageNo,
        };
    }

    // 获得单个Error列表
    async getOneErrorList(appId, url, category, pageNo, pageSize, beginTime, endTime) {
        pageNo = pageNo * 1;
        pageSize = pageSize * 1;

        const query = { resource_url: url, category };
        if (beginTime && endTime) query.create_time = { $gte: new Date(beginTime), $lte: new Date(endTime) };

        const count = Promise.resolve(this.app.models.WebErrors(appId).count(query).read('sp')
            .exec());
        const datas = Promise.resolve(
            this.app.models.WebErrors(appId).aggregate([
                { $match: query },
                { $sort: { create_time: -1 } },
                { $skip: (pageNo - 1) * pageSize },
                { $limit: pageSize },
            ]).read('sp')
                .exec()
        );
        const all = await Promise.all([ count, datas ]);
        const [ totalNum, datalist ] = all;

        return {
            datalist,
            totalNum,
            pageNo,
        };
    }

    // 单个error详情信息
    async getErrorDetail(appId, id) {
        return await this.app.models.WebErrors(appId).findOne({ _id: id }).read('sp')
            .exec() || {};
    }

}

module.exports = ErroesService;
