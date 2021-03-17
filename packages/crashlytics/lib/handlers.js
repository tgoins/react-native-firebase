/*
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this library except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import { firebase } from '@react-native-firebase/app';
import { isError, once } from '@react-native-firebase/app/lib/common';
import tracking from 'promise/setimmediate/rejection-tracking';
import StackTrace from 'stacktrace-js';

export const FATAL_FLAG = 'com.firebase.crashlytics.reactnative.fatal';

export function createNativeErrorObj(error, stackFrames, isUnhandledRejection, jsErrorName) {
  const nativeObj = {};

  nativeObj.message = `${error.message}`;
  nativeObj.isUnhandledRejection = isUnhandledRejection;

  nativeObj.frames = [];

  if (jsErrorName) {
    // Option to fix crashlytics display and alerting. You can add an error name to the recordError function
    nativeObj.frames.push({
      src: '<unknown>',
      line: 0,
      col: 0,
      fn: '<unknown>',
      file: jsErrorName,
    });
  }

  for (let i = 0; i < stackFrames.length; i++) {
    const { columnNumber, lineNumber, fileName, functionName, source } = stackFrames[i];
    let fileNameParsed = '<unknown>';
    if (fileName) {
      const subStrLen = fileName.indexOf('?');
      if (subStrLen < 0) {
        fileNameParsed = fileName;
      } else if (subStrLen > 0) {
        fileNameParsed = fileName.substring(0, subStrLen);
      }
    }

    nativeObj.frames.push({
      src: source,
      line: lineNumber || 0,
      col: columnNumber || 0,
      fn: functionName || '<unknown>',
      file: `${fileNameParsed}:${lineNumber || 0}:${columnNumber || 0}`,
    });
  }

  return nativeObj;
}

export const setGlobalErrorHandler = once(nativeModule => {
  const originalHandler = ErrorUtils.getGlobalHandler();

  async function handler(error, fatal) {
    if (__DEV__) {
      return originalHandler(error, fatal);
    }

    if (!isError(error)) {
      await nativeModule.logPromise(`Unknown Error: ${error}`);
      return originalHandler(error, fatal);
    }

    if (nativeModule.isErrorGenerationOnJSCrashEnabled) {
      try {
        const stackFrames = await StackTrace.fromError(error, { offline: true });

        // Flag the Crashlytics backend that we have a fatal error, they will transform it
        // Roughly analogous to provided Swift example `Int(Date().timeIntervalSince1970) + 1`
        await nativeModule.setAttribute(FATAL_FLAG, Math.round(new Date() / 1000) + '');

        // Notify analytics, if it exists - throws error if not
        try {
          await firebase
            .app()
            .analytics()
            .logEvent(
              '_ae', // '_ae' is a reserved analytics key for app exceptions
              {
                fatal: 1, // as in firebase-android-sdk
                timestamp: Date.now() + '', // firebase-android-sdk example:java.util.Date.getTime().toString()
              },
            );
        } catch (_) {
          // This just means analytics was not present, so we could not log the analytics event
        }

        await nativeModule.recordErrorPromise(createNativeErrorObj(error, stackFrames, false));
      } catch (_) {
        // do nothing
      }
    }
    return originalHandler(error, fatal);
  }

  ErrorUtils.setGlobalHandler(handler);
  return handler;
});

export const setOnUnhandledPromiseRejectionHandler = once(nativeModule => {
  async function onUnhandled(id, error) {
    if (!__DEV__) {
      // TODO(salakar): Option to disable
      try {
        const stackFrames = await StackTrace.fromError(error, { offline: true });
        await nativeModule.recordErrorPromise(createNativeErrorObj(error, stackFrames, true));
      } catch (_) {
        // do nothing
      }
    }
  }
  tracking.enable({
    allRejections: true,
    onUnhandled,
  });

  return onUnhandled;
});
