'use strict';
const parser = require('cron-parser');
const Service = require('egg').Service;

class RemoveService extends Service {

    /*
     * 定时删除原始上报数据 一天删一次
     *
     * @param {string} [type='web']
     * @returns
     * @memberof RemoveService
     */
    async deleteDb1WebData(type = 'web') {
        try {
            const interval = parser.parseExpression(this.app.config.pvuvip_task_day_time);
            interval.prev();
            interval.prev();
            const endTime = new Date(interval.prev().toString());

            const query = { create_time: { $lt: endTime } };
            let result = '';
            if (type === 'web') {
                result = await this.ctx.model.Web.WebReport.remove(query).exec();
            }
            return result;
        } catch (err) {
            return {};
        }
    }

    /*
     * 清空db2 number日之前所有性能数据
     *
     * @param {*} appId
     * @param {*} number
     * @param {string} [type='web']
     * @returns
     * @memberof RemoveService
     */
    async deleteDb2WebData(appId, number, type = 'web') {
        number = number * 1;
        const interval = parser.parseExpression(this.app.config.pvuvip_task_day_time);
        const endTime = new Date(new Date(interval.prev().toString()).getTime() - number * 86400000);
        const query = { create_time: { $lt: endTime } };
        let result = null;

        if (type === 'web') {
            // Ajax
            const remove1 = Promise.resolve(this.app.models.WebAjaxs(appId).remove(query).exec());
            // Pages
            const remove2 = Promise.resolve(this.app.models.WebPages(appId).remove(query).exec());
            // Environment
            const remove3 = Promise.resolve(this.app.models.WebEnvironment(appId).remove(query).exec());
            // Errors
            const remove4 = Promise.resolve(this.app.models.WebErrors(appId).remove(query).exec());
            // Resource
            const remove5 = Promise.resolve(this.app.models.WebResource(appId).remove(query).exec());
            result = await Promise.all([ remove1, remove2, remove3, remove4, remove5 ]);
        }
        return result;
    }
}

module.exports = RemoveService;
