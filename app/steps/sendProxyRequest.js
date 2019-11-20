'use strict';

var chunkLength = require('../../lib/chunkLength');
const HttpsProxyAgent = require('https-proxy-agent');
const HttpProxyAgent = require('http-proxy-agent');

const NO_PROXY_HOSTNAMES = (() => {
  const result = [];
  const { no_proxy, NO_PROXY } = process.env;
  [no_proxy, NO_PROXY].filter(p => !!p && p.trim()).forEach(p => p.split(/;|,/).forEach(s => result.push(s)));

  return result;
})();


function sendProxyRequest(Container) {
  var req = Container.user.req;
  var bodyContent = Container.proxy.bodyContent;
  var reqOpt = Container.proxy.reqBuilder;
  var options = Container.options;

  return new Promise(function (resolve, reject) {
    var protocol = Container.proxy.requestModule;

    const { HTTP_PROXY, http_proxy, HTTPS_PROXY, https_proxy } = process.env;
    const proxy = [HTTP_PROXY, http_proxy, HTTPS_PROXY, https_proxy].find(p => p);

    if (proxy) {
      if (NO_PROXY_HOSTNAMES.indexOf(req.hostname) < 0) {
        const Agent = options.https ? HttpsProxyAgent : HttpProxyAgent;
        reqOpt.agent = new Agent(proxy);
      }
    }

    var proxyReq = Container.proxy.req = protocol.request(reqOpt, function (rsp) {
      if (options.stream) {
        Container.proxy.res = rsp;
        return resolve(Container);
      }

      var chunks = [];
      rsp.on('data', function (chunk) { chunks.push(chunk); });
      rsp.on('end', function () {
        Container.proxy.res = rsp;
        Container.proxy.resData = Buffer.concat(chunks, chunkLength(chunks));
        resolve(Container);
      });
      rsp.on('error', reject);
    });

    proxyReq.on('socket', function (socket) {
      if (options.timeout) {
        socket.setTimeout(options.timeout, function () {
          proxyReq.abort();
        });
      }
    });

    proxyReq.on('error', reject);

    // this guy should go elsewhere, down the chain
    if (options.parseReqBody) {
      // We are parsing the body ourselves so we need to write the body content
      // and then manually end the request.

      //if (bodyContent instanceof Object) {
      //throw new Error
      //debugger;
      //bodyContent = JSON.stringify(bodyContent);
      //}

      if (bodyContent.length) {
        var body = bodyContent;
        var contentType = proxyReq.getHeader('Content-Type');
        if (contentType === 'x-www-form-urlencoded' || contentType === 'application/x-www-form-urlencoded') {
          try {
            var params = JSON.parse(body);
            body = Object.keys(params).map(function (k) { return k + '=' + params[k]; }).join('&');
          } catch (e) {
            // bodyContent is not json-format
          }
        }
        proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
        proxyReq.write(body);
      }
      proxyReq.end();
    } else {
      // Pipe will call end when it has completely read from the request.
      req.pipe(proxyReq);
    }

    req.on('aborted', function () {
      // reject?
      proxyReq.abort();
    });
  });
}


module.exports = sendProxyRequest;
