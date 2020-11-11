'use strict';

module.exports = app => {
    const mongoose = app.mongoose;
    const Schema = mongoose.Schema;
    const conn = app.mongooseDB.get('db3');

    const WebAjaxsSchema = new Schema({
        app_id: { type: String }, // 所属系统ID
        create_time: { type: Date, default: Date.now },
        url: { type: String }, // 访问的ajaxUrl
        speed_type: { type: Number }, // 访问速度类型 1：正常  2：慢
        method: { type: String }, // 资源请求方式
        duration: { type: Number, default: 0 }, // AJAX响应时间 单位：ms
        decoded_body_size: { type: Number, default: 0 }, // 返回字段大小  单位：B
        options: { type: String }, // ajax请求参数
        full_url: { type: String }, // 完整url
        call_url: { type: String }, // 调用页面的URL
        mark_page: { type: String }, // 所有资源页面统一标识 html img css js 用户系统信息等
        mark_user: { type: String }, // 统一某一时间段用户标识
    }, {
        shardKey: { _id: 'hashed' },
    });

    WebAjaxsSchema.index({ speed_type: 1, url: 1, create_time: -1 });
    WebAjaxsSchema.index({ speed_type: 1, call_url: 1, create_time: -1 });

    app.models.WebAjaxs = function(appId) {
        return conn.model(`web_ajaxs_${appId}`, WebAjaxsSchema);
    };
};
