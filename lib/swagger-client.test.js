/* eslint-disable max-nested-callbacks */
/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const nock = require('nock')

const Client = require('./swagger-client').Client
const KubeConfig = require('./config')
const Request = require('../backends/request')

const url = 'http://mock.kube.api'
const kubeconfig = new KubeConfig()
kubeconfig.loadFromClusterAndUser(
  { name: 'cluster', server: url },
  { name: 'user' })

describe('lib.swagger-client', () => {
  describe('.Client', () => {
    describe('.loadSpec', () => {
      describe('on a cluster with the /openapi/v2 route', () => {
        before(() => {
          nock(url)
            .get('/openapi/v2')
            .reply(200, {
              paths: {
                '/api/': {
                  get: {
                    operationId: 'getCoreAPIVersions'
                  }
                }
              }
            })
        })

        it('creates a dynamically generated client', done => {
          const backend = new Request({ kubeconfig })
          const client = new Client({ backend })
          client.loadSpec()
            .then(() => {
              expect(client.api.get).is.a('function')
              done()
            })
            .catch(err => done(err))
        })
      })

      describe('on a cluster without the /openapi/v2 route but with the /swagger.json route', () => {
        before(() => {
          nock(url)
            .get('/openapi/v2')
            .reply(404, 'Not Found')

          nock(url)
            .get('/swagger.json')
            .reply(200, {
              paths: {
                '/api/': {
                  get: {
                    operationId: 'getCoreAPIVersions'
                  }
                }
              }
            })
        })

        it('creates a dynamically generated client', (done) => {
          const backend = new Request({ kubeconfig })
          const client = new Client({ backend })
          client.loadSpec()
            .then(() => {
              expect(client.api.get).is.a('function')
              done()
            })
            .catch(err => done(err))
        })
      })

      describe('on a cluster without the /openapi/v2 route and a non-200 status code on /swagger.json', () => {
        before(() => {
          nock(url)
            .get('/openapi/v2')
            .reply(404, 'Not Found')

          nock(url)
            .get('/swagger.json')
            .reply(500, {
              paths: {
                '/api/': {
                  get: {
                    operationId: 'getCoreAPIVersions'
                  }
                }
              }
            })
        })

        it('returns an error message with the status code', (done) => {
          const backend = new Request({ kubeconfig })
          const client = new Client({ backend })
          client.loadSpec()
            .then(() => {
              const err = new Error('This test should have caused an error')
              done(err)
            })
            .catch(err => {
              expect(err).to.be.an('Error')
              done()
            })
        })
      })

      describe('on a cluster returning a non-200, non-404 status code on the /openapi/v2 route', () => {
        before(() => {
          nock(url)
            .get('/openapi/v2')
            .reply(500, 'Internal Error')

          nock(url)
            .get('/swagger.json')
            .reply(500, {
              paths: {
                '/api/': {
                  get: {
                    operationId: 'getCoreAPIVersions'
                  }
                }
              }
            })
        })

        it('returns an error message with the status code', (done) => {
          const backend = new Request({ kubeconfig })
          const client = new Client({ backend })
          client.loadSpec()
            .then(() => {
              const err = new Error('This test should have caused an error')
              done(err)
            })
            .catch(err => {
              expect(err).to.be.an('Error')
              done()
            })
        })
      })
    })

    describe('._getByteStream', () => {
      it('logs returns HTTP stream', async () => {
        nock(url)
          .get('/api/v1/namespaces/foo/pods/bar/log')
          .reply(200, 'hello')

        const backend = new Request({ kubeconfig })
        const client = new Client({ backend, version: '1.21' })
        const stream = await client.api.v1.namespaces('foo').pods('bar').log.getByteStream()
        return new Promise((resolve, reject) => {
          stream.on('data', data => {
            expect(data.toString()).to.equal('hello')
            stream.destroy()
            resolve()
          })
          stream.on('error', err => {
            reject(err)
          })
        })
      })
    })

    describe('._getObjectStream', () => {
      it('watch endpoint returns HTTP stream', async () => {
        nock(url)
          .get('/api/v1/watch/namespaces')
          .reply(200, {
            type: 'ADDED'
          })

        const backend = new Request({ kubeconfig })
        const client = new Client({ backend, version: '1.21' })
        const stream = await client.api.v1.watch.namespaces.getObjectStream()
        return new Promise((resolve, reject) => {
          stream.on('data', obj => {
            expect(obj).to.deep.equal({ type: 'ADDED' })
            stream.destroy()
            resolve()
          })
          stream.on('error', err => {
            reject(err)
          })
        })
      })
    })

    describe('.constructor', () => {
      it('creates a dynamically generated client synchronously based on version', () => {
        const backend = new Request({ kubeconfig })
        const client = new Client({ backend, version: '1.21' })
        expect(client.api.get).is.a('function')
      })

      it('aliases resources', () => {
        const spec = {
          paths: {
            '/foo/deployments': {
              get: {
                operationId: 'fooDeploymentsGet'
              }
            }
          }
        }
        const client = new Client({ spec, backend: {} })
        expect(client.foo.deployments).is.an('object')
        expect(client.foo.deployment).is.an('object')
        expect(client.foo.deploy).is.an('object')
      })

      it('adds functions for Namespaced CustomResourceDefinitions', () => {
        const client = new Client({ spec: { paths: {} }, backend: {} })
        const versions = [
          {
            name: 'v1beta1',
            served: true,
            storage: false
          },
          {
            name: 'v1beta2',
            served: true,
            storage: true
          }
        ]
        const crd = {
          spec: {
            scope: 'Namespaced',
            group: 'stable.example.com',
            versions,
            names: {
              plural: 'foos'
            }
          }
        }
        client.addCustomResourceDefinition(crd)
        versions.forEach(({ name: version }) => {
          expect(client.apis['stable.example.com'][version].foos.get).is.a('function')
          expect(client.apis['stable.example.com'][version].namespaces('default').foos.get).is.a('function')
          expect(client.apis['stable.example.com'][version].namespaces('default').foos.post).is.a('function')
          expect(client.apis['stable.example.com'][version].namespaces('default').foos('blah').get).is.a('function')
          expect(client.apis['stable.example.com'][version].namespaces('default').foos('blah').delete).is.a('function')
          expect(client.apis['stable.example.com'][version].namespaces('default').foos('blah').get).is.a('function')
          expect(client.apis['stable.example.com'][version].namespaces('default').foos('blah').patch).is.a('function')
          expect(client.apis['stable.example.com'][version].namespaces('default').foos('blah').put).is.a('function')
          expect(client.apis['stable.example.com'][version].watch.foos.getStream).is.a('function')
          expect(client.apis['stable.example.com'][version].watch.namespaces('default').foos.getStream).is.a('function')
          expect(client.apis['stable.example.com'][version].watch.namespaces('default').foos('blah').getStream).is.a('function')
        })
      })

      it('adds functions for Cluster CustomResourceDefinitions', () => {
        const client = new Client({ spec: { paths: {} }, backend: {} })
        const versions = [
          {
            name: 'v1beta1',
            served: true,
            storage: false
          },
          {
            name: 'v1beta2',
            served: true,
            storage: true
          }
        ]
        const crd = {
          spec: {
            scope: 'Cluster',
            group: 'stable.example.com',
            versions,
            names: {
              plural: 'foos'
            }
          }
        }
        client.addCustomResourceDefinition(crd)
        versions.forEach(({ name: version }) => {
          expect(client.apis['stable.example.com'][version].foos.get).is.a('function')
          expect(client.apis['stable.example.com'][version].foos.post).is.a('function')
          expect(client.apis['stable.example.com'][version].foos('blah').get).is.a('function')
          expect(client.apis['stable.example.com'][version].foos('blah').delete).is.a('function')
          expect(client.apis['stable.example.com'][version].foos('blah').get).is.a('function')
          expect(client.apis['stable.example.com'][version].foos('blah').patch).is.a('function')
          expect(client.apis['stable.example.com'][version].foos('blah').put).is.a('function')
          expect(client.apis['stable.example.com'][version].watch.foos.getStream).is.a('function')
          expect(client.apis['stable.example.com'][version].watch.foos.getStream).is.a('function')
          expect(client.apis['stable.example.com'][version].watch.foos('blah').getStream).is.a('function')
        })
      })

      it('supports deprecated "version" field for Namespaced CustomResourceDefinitions', () => {
        const client = new Client({ spec: { paths: {} }, backend: {} })
        const crd = {
          spec: {
            scope: 'Namespaced',
            group: 'stable.example.com',
            version: 'v1',
            names: {
              plural: 'foos'
            }
          }
        }
        client.addCustomResourceDefinition(crd)
        expect(client.apis['stable.example.com'].v1.foos.get).is.a('function')
        expect(client.apis['stable.example.com'].v1.namespaces('default').foos.get).is.a('function')
        expect(client.apis['stable.example.com'].v1.namespaces('default').foos.post).is.a('function')
        expect(client.apis['stable.example.com'].v1.namespaces('default').foos('blah').get).is.a('function')
        expect(client.apis['stable.example.com'].v1.namespaces('default').foos('blah').delete).is.a('function')
        expect(client.apis['stable.example.com'].v1.namespaces('default').foos('blah').get).is.a('function')
        expect(client.apis['stable.example.com'].v1.namespaces('default').foos('blah').patch).is.a('function')
        expect(client.apis['stable.example.com'].v1.namespaces('default').foos('blah').put).is.a('function')
        expect(client.apis['stable.example.com'].v1.watch.foos.getStream).is.a('function')
        expect(client.apis['stable.example.com'].v1.watch.namespaces('default').foos.getStream).is.a('function')
        expect(client.apis['stable.example.com'].v1.watch.namespaces('default').foos('blah').getStream).is.a('function')
      })

      it('supports deprecated "version" field for Cluster CustomResourceDefinitions', () => {
        const client = new Client({ spec: { paths: {} }, backend: {} })
        const crd = {
          spec: {
            scope: 'Cluster',
            group: 'stable.example.com',
            version: 'v1',
            names: {
              plural: 'foos'
            }
          }
        }
        client.addCustomResourceDefinition(crd)
        expect(client.apis['stable.example.com'].v1.foos.get).is.a('function')
        expect(client.apis['stable.example.com'].v1.foos.post).is.a('function')
        expect(client.apis['stable.example.com'].v1.foos('blah').get).is.a('function')
        expect(client.apis['stable.example.com'].v1.foos('blah').delete).is.a('function')
        expect(client.apis['stable.example.com'].v1.foos('blah').get).is.a('function')
        expect(client.apis['stable.example.com'].v1.foos('blah').patch).is.a('function')
        expect(client.apis['stable.example.com'].v1.foos('blah').put).is.a('function')
        expect(client.apis['stable.example.com'].v1.watch.foos.getStream).is.a('function')
        expect(client.apis['stable.example.com'].v1.watch.foos.getStream).is.a('function')
        expect(client.apis['stable.example.com'].v1.watch.foos('blah').getStream).is.a('function')
      })
    })
  })
})
