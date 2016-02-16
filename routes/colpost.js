/* global module, require, err */

"use strict";

// used when evaluating incoming expressions
//noinspection JSUnusedLocalSymbols
var ObjectId = require('mongodb').ObjectID;
//noinspection JSUnusedLocalSymbols
var MongoDoc = require('../modules/mongodoc');
//noinspection JSUnusedLocalSymbols
var ISODate = function(d){
	return new Date(d);
};


module.exports = function(req, res, next){
	var col = req.collection
	,	dbpath = '/db/' + req.db.databaseName + '/';

	if(req.body.id)
		var query = {_id: req.mongoMng.parseId(req.body.id)};

	res.locals.op = req.body.op || req.params.op;

	switch(res.locals.op){
		case 'truncate':
			col.remove({}, function(err){
				if(!err)
					return res.redirect(req.path);

				res.locals.message = err.message;

				req.mongoMng.getCollections(res.locals.dbname, function(err, collections){
					res.render('collerror', {collections: collections});
				});
			});
			break;
		case 'drop':
			col.drop(function(err){
				var red = err ? req.path + '?err=' + err.message : '/db/' + res.locals.dbname;

				req.res.redirect(red);
			});
			break;
		case 'renameCollection':
			try{
				col.rename(req.body.name, function(err){
					if(err)
						res.redirect(dbpath + col.collectionName + '?op=rename&msg=' + err.message);
					else
						res.redirect(dbpath + req.body.name);
				});
			} catch(err){
				res.redirect(dbpath + col.collectionName + '?op=rename&msg=' + err.message);
			}
			break;
		case 'setField':
			let update = {$set: {}};
			let value;

			switch(req.body.type){
				case 'number':
					value = Number(req.body.value);
					break;
				case 'binary':
					try{
						value = new Buffer(req.body.value, 'hex');
					} catch(err){
						return res.send({error: err.message});
					}
					break;
				case 'boolean':
				case 'mixed':
					try {
						eval('value=' + req.body.value);
					} catch(err){
						res.send({error: err.message});
					}
					break;
				default:
					value = req.body.value;
			}

			update.$set[req.body.field] = value;
			
			col.update(query, update, function(err, r){
				res.send({error: err && err.message, affected: r});
			});
			break;
		case 'deleteRow':
			col.remove(query, function(err, r){
				res.send({error: err && err.message, affected: r});
			});
			break;
		case 'deleteField':
			let update;

			eval('update = {$unset: {"' + req.body.key + '": ""}}');

			col.update(query, update, function(err, r){
				res.send({error: err && err.message, affected: r});
			});
			break;
		case 'insert':
			var redirect = req.path + '?op=insert&json=' + encodeURIComponent(req.body.json);
			
			try{
				var json;

				eval('json = ' + req.body.json);

				if(!Object.keys(json).length)
					return req.res.redirect(req.path);

				col.insert(json, function(err){
					res.redirect(redirect + '&msg=' + (err ? err.message : 'ok'));
				});
			} catch(e){
				res.redirect(redirect + '&msg=parseError');
			}
			break;

		case 'duplicate':
			col.findOne(query, function(err, doc){
				if(err)
					return res.send({error: err});

				if(!doc)
					return res.send({error: "Doc not found"});

				// remove _id
				delete doc._id;

				// remove unique index fields
				col.indexes(function(err, r){
					if(err)
						return res.send({error: err});

					r.forEach(function(idx){
						if(idx.unique){
							Object.keys(idx.key).forEach(function(k){
								if(idx.key[k])
									doc[k] = "unique index field " + Date.now();
							});
						}
					});

					col.insert(doc, function(err){
						if(err)
							return res.send({error: err.message});

						res.send(doc);
					});
				});
			});
			break;

		case 'renameField':
			var rename = {};

			rename[req.body.key] = req.body.name;

			col.update(query, {$rename: rename}, function(err, r){
				if(err)
					return res.json({error: err.message});
				
				res.json(r.result.n === 1 ? req.body.name : {error: 'not modified'});
			});
			break;

		case 'create-index':
			var fields = req.body.fields
			,	order = req.body.order;

			if(typeof fields === 'string')
				fields = [fields];

			if(typeof order === 'string')
				order = [order];

			var attr = {};

			fields.forEach(function(field, i){
				attr[field] = order[i] === 'asc' ? 1 : -1;
			});

			var options = {
				background: 1,
				safe: 1
			};

			if(req.body.is_unique){
				options.unique = 1;

				if(req.body.drop_duplicate)
					options.dropDups = 1;
			}

			var name = req.body.name.trim();

			if(name)
				options.name = name;

			col.ensureIndex(attr, options, function(err){
				if(err)
					return next(err);

				res.redirect(req.path + '/indexes');
			});
			break;

		case 'dup':
			req.mongoMng.getCollections(res.locals.dbname, function(err, collections){
				if(err)
					return next(err);
				
				if(collections.some(function(col_){
					return col_.name === req.body.name;
				}))
					return res.redirect(req.path + '?err=Collection "' + req.body.name + '" already exists');
				
				col.indexes(function(err, r){//return res.send(req.body)
					if(err)
						return next(err);

					var error
					,	count = 0
					,	newcol = req.db.collection(req.body.name);

					r.forEach(function(idx){
						var options = {};

						['unique', 'name', 'background', 'dropDups'].forEach(function(n){
							if(idx[n] !== undefined)
								options[n] = idx[n];
						});


						newcol.ensureIndex(idx.key, options, function(err){
							if(err)
								return error = err;

							if(++count === r.length)
								doCopyCollection();
						});
					});

					function doCopyCollection(){
						if(err)
							return next(err);

						col.find(function(err, cursor){
							if(err)
								return next(err);

							cursor.count(function(err, count){
								if(err)
									return next(err);

								var count_ = 0;

								cursor.each(function(err, o){
									if(err)
										return next(err);

									if(!o)
										return;

									newcol.insert(o, {w: 1}, function(err){
										if(err)
											return next(err);

										if(++count_ === count){
											res.redirect('/db/' + req.db.databaseName + '/' + req.body.name);
										}
									});
								});
							});
						});
					}
				});
			});
			break;
			
		default:
			next();
	}
};